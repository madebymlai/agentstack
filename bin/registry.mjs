export const REGISTRY = {
  'tokf': {
    platforms: ['linux-x86_64', 'darwin-arm64', 'darwin-x86_64'],
    githubRelease: {
      repo: 'mpecan/tokf',
      tagPrefix: 'tokf-v',
      targets: {
        'linux-x86_64': 'x86_64-unknown-linux-gnu',
        'darwin-arm64': 'aarch64-apple-darwin',
        'darwin-x86_64': 'x86_64-apple-darwin',
      },
      binName: 'tokf',
    },
    postInstall: {
      claude: ['tokf hook install --global'],
      opencode: ['tokf hook install --tool opencode --global'],
      codex: ['tokf hook install --tool codex --global'],
    },
  },
  'codebase-memory': {
    binName: 'codebase-memory-mcp',
    latestVersionRepo: 'DeusData/codebase-memory-mcp',
    install: {
      unix: 'curl -fsSL https://raw.githubusercontent.com/DeusData/codebase-memory-mcp/main/install.sh | bash',
      win32: [
        'Invoke-WebRequest -Uri https://raw.githubusercontent.com/DeusData/codebase-memory-mcp/main/install.ps1 -OutFile $env:TEMP\\install-codebase-memory.ps1',
        '& $env:TEMP\\install-codebase-memory.ps1',
      ],
    },
    postInstall: [
      'codebase-memory-mcp config set auto_index true',
      'codebase-memory-mcp config set auto_index_limit 50000',
    ],
  },
};
