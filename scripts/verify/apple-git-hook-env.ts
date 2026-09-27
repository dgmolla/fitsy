import { join } from 'node:path';

// Git's Apple launcher changes a hook's environment; Linux CI needs the same inputs.
export function appleGitHookEnvironment(directory: string, caller: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  if (process.platform === 'darwin') return caller;
  const developer = join(directory, 'Xcode', 'Contents', 'Developer');
  const sdk = `${developer}/Platforms/MacOSX.platform/Developer/SDKs/MacOSX.sdk`;
  const manpath = [
    `${sdk}/usr/share/man`,
    `${developer}/Platforms/MacOSX.platform/usr/share/man`,
    `${developer}/usr/share/man`,
    `${developer}/Toolchains/XcodeDefault.xctoolchain/usr/share/man`,
  ].join(':') + ':';
  return {
    ...caller,
    PATH: `${developer}/usr/libexec/git-core:${caller.PATH}`,
    CPATH: [caller.CPATH, '/usr/local/include'].filter(Boolean).join(':'),
    LIBRARY_PATH: [caller.LIBRARY_PATH, '/usr/local/lib'].filter(Boolean).join(':'),
    MANPATH: manpath + (caller.MANPATH ?? ''),
    SDKROOT: caller.SDKROOT ?? sdk,
  };
}
