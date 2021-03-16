import * as commander from 'commander';
import * as fs from 'fs-extra';
import semver from 'semver';

import { app } from 'electron';
import { BisectResult, GistInfo, ElectronReleaseChannel, OutputEntry, RunResult } from '../interfaces';
import { IpcEvents } from '../ipc-events';
import { normalizeVersion } from '../utils/normalize-version';
import { ipcMainManager } from './ipc';

const program = new commander.Command();

function optFiddle(opts: commander.OptionValues) {
  // load the fiddle
  const { fiddle } = opts;
  console.log(`Loading ${fiddle}`);
  ipcMainManager.send(IpcEvents.FS_OPEN_FIDDLE, [fiddle]);
}

function optVersion(opts: commander.OptionValues) {
  // load a version
  const { version } = opts;
  if (version) {
    console.log(`Setting version ${version}`);
    ipcMainManager.send(IpcEvents.SET_VERSION, [version]);
  }
}

function optShow(opts: commander.OptionValues) {
  // activate any channels that the user requested
  const channels = [];
  if (opts.betas) channels.push(ElectronReleaseChannel.beta);
  if (opts.nightlies) channels.push(ElectronReleaseChannel.nightly);
  if (channels.length > 0) {
    console.log(`Showing ${channels.join(', ')}`);
    ipcMainManager.send(IpcEvents.SHOW_CHANNELS, channels);
  }
}

function optHide(opts: commander.OptionValues) {
  // deactivate any channels that the user requested
  const channels = [];
  if (opts.betas === false) channels.push(ElectronReleaseChannel.beta);
  if (opts.nightlies === false) channels.push(ElectronReleaseChannel.nightly);
  if (channels.length > 0) {
    console.log(`Hiding ${channels.join(', ')}`);
    ipcMainManager.send(IpcEvents.HIDE_CHANNELS, channels);
  }
}

function onOutputEntry(_event: Electron.IpcMainEvent, message: OutputEntry) {
  console.log(`[${new Date(message.timestamp).toLocaleTimeString()}] ${message.text}`);
};

/**
 * Execute the 'bisect' command
 *
 * @param {string} known good version
 * @param {string} known bad version
 * @param {commander.OptionValues} commander options
 */
function bisect(good: string, bad: string, opts: commander.OptionValues) {
  optHide(opts);
  optShow(opts);
  optFiddle(opts);

  // minor sanitization for good, bad version numbers
  good = normalizeVersion(good);
  bad = normalizeVersion(bad);
  if (semver.compare(good, bad) > 0) {
    [good, bad] = [bad, good];
    console.warn(`Swapping so that ${good} comes before ${bad}`);
  }

  // bisect the fiddle
  ipcMainManager.on(IpcEvents.OUTPUT_ENTRY, onOutputEntry);
  ipcMainManager.once(IpcEvents.BISECT_DONE, (_, result: BisectResult) => {
    app.exit(result.goodVersion && result.badVersion ? 0 : 1);
  });
  ipcMainManager.send(IpcEvents.FIDDLE_BISECT, [good, bad]);
}

function logWhenDone(name, exitWhenDone = false) {
  ipcMainManager.once(IpcEvents.COMMAND_DONE, (_, success) => {
    console.log(`command ${success ? 'succeeded' : 'failed'}: ${name}`);
    if (exitWhenDone) {
      app.exit(success ? 0 : 1);
    }
  });
}

function open(source: string) {
  if (fs.existsSync(source)) {
    logWhenDone(`open fiddle "${source}"`);
    ipcMainManager.send(IpcEvents.FS_OPEN_FIDDLE, [ source ]);
    return;
  }

  // maybe it's a gist.
  // handle these variants:
  // https://gist.github.com/ckerr/af3e1a018f5dcce4a2ff40004ef5bab5/
  // https://gist.github.com/ckerr/af3e1a018f5dcce4a2ff40004ef5bab5
  // https://gist.github.com/af3e1a018f5dcce4a2ff40004ef5bab5/
  // https://gist.github.com/af3e1a018f5dcce4a2ff40004ef5bab5
  // af3e1a018f5dcce4a2ff40004ef5bab5
  let id: string | undefined = source;
  if (source.startsWith('https://gist.github.com')) {
    if (source.endsWith('/')) {
      source = source.slice(0, -1);
    }
    id = source.split('/').pop();
  }
  if (id && id.match(/[0-9A-Fa-f]{32}/)) {
    logWhenDone(`open gist "${id}"`);
    const gistInfo: GistInfo = {
      id,
      confirmed: true
    };
    ipcMainManager.send(IpcEvents.LOAD_GIST_REQUEST, [ gistInfo ]);
  }
}

function test(opts: commander.OptionValues) {
  optFiddle(opts);
  optVersion(opts);

  // run the fiddle
  ipcMainManager.on(IpcEvents.OUTPUT_ENTRY, onOutputEntry);
  ipcMainManager.once(IpcEvents.RUN_DONE, (_, result: RunResult) => {
    console.log(result);
    app.exit(result === RunResult.SUCCESS ? 0 : 1);
  });
  ipcMainManager.send(IpcEvents.FIDDLE_RUN);
}

export async function processCommandLine() {
  program
    .command('open <path-or-url>')
    .description('Open a fiddle from a local directory or a gist')
    .action(open);

  program
    .command('bisect <goodVersion> <badVersion>')
    .description('Find where regressions were introduced')
    .option('--fiddle-dir <dir>', 'Load fiddle from a local directory')
    .option('--fiddle-gist <dir>', 'Load fiddle from a remote gist')
    .option('--nightlies', 'Include nightly releases')
    .option('--no-nightlies', 'Omit nightly releases')
    .option('--betas', 'Include beta releases')
    .option('--no-betas', 'Omit beta releases')
    .action(bisect);

  program
    .command('test')
    .description('Test a fiddle')
    .option('--version <version>', 'Use Electron version', process.cwd())
    .option('--fiddle <path>', 'Fiddle source', process.cwd())
    .action(test);

  program
   .addHelpText('after', `

Example calls:
  $ electron-fiddle open /path/to/fiddle
  $ electron-fiddle open https://gist.github.com/ckerr/af3e1a018f5dcce4a2ff40004ef5bab5
  $ electron-fiddle open af3e1a018f5dcce4a2ff40004ef5bab5

  $ electron-fiddle test --fiddle /path/to/fiddle --version 11.2.0

  $ electron-fiddle bisect 10.0.0 11.2.0 --fiddle /path/to/fiddle
  $ electron-fiddle bisect 10.0.0 11.2.0 --fiddle /path/to/fiddle --betas --nightlies`);

  const { argv } = process;
  if (argv.length > 2) {
    program.parse(argv, { from: 'electron' });
  }
};
