export const REGISTRY = {
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
