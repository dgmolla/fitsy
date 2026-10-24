// Inject the Apple launcher's environment inside a Linux Git hook, after Git
// has added its own git-core PATH entry. macOS uses the real launcher instead.
const developer = '/tmp/fitsy-xcode/Contents/Developer';
const sdk = `${developer}/Platforms/MacOSX.platform/Developer/SDKs/MacOSX.sdk`;
const manpath = [
  `${sdk}/usr/share/man`,
  `${developer}/Platforms/MacOSX.platform/usr/share/man`,
  `${developer}/usr/share/man`,
  `${developer}/Toolchains/XcodeDefault.xctoolchain/usr/share/man`,
].join(':') + ':';

export const appleGitHookPrologue = `
if [[ "\${PATH%%:*}" != */usr/libexec/git-core ]]; then
  case "\${PATH%%:*}" in */git-core) caller_path="\${PATH#*:}" ;; *) caller_path="$PATH" ;; esac
  export PATH="${developer}/usr/libexec/git-core:$caller_path"
  export CPATH="\${CPATH-}\${CPATH:+:}/usr/local/include"
  export LIBRARY_PATH="\${LIBRARY_PATH-}\${LIBRARY_PATH:+:}/usr/local/lib"
  export MANPATH="${manpath}\${MANPATH-}"
  if [[ -z "\${SDKROOT-}" ]]; then export SDKROOT="${sdk}"; fi
fi
`;
