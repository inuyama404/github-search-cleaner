#requires -Version 5.1
$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$extension = Join-Path $root 'extension'
$dist = Join-Path $root 'dist'
$build = Join-Path $root 'build'
$node = 'C:\Users\HACHI\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe'

if (-not (Test-Path $node)) {
  $node = 'node'
}

Remove-Item $dist -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item $build -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Path $dist, $build | Out-Null

$chromeZip = Join-Path $dist 'github-search-cleaner-chrome.zip'
Compress-Archive -Path (Join-Path $extension '*') -DestinationPath $chromeZip -Force

$firefoxDir = Join-Path $build 'firefox'
Copy-Item $extension $firefoxDir -Recurse

$patch = @'
const fs = require('fs');
const file = process.argv[2];
const manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
manifest.browser_specific_settings = {
  gecko: {
    id: 'github-search-cleaner@local',
    strict_min_version: '115.0'
  }
};
fs.writeFileSync(file, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
'@
$patchFile = Join-Path $build 'patch-firefox.js'
Set-Content -Path $patchFile -Value $patch -Encoding UTF8
& $node $patchFile (Join-Path $firefoxDir 'manifest.json')
if ($LASTEXITCODE -ne 0) { throw 'Failed to patch Firefox manifest' }

$firefoxZip = Join-Path $dist 'github-search-cleaner-firefox.zip'
Compress-Archive -Path (Join-Path $firefoxDir '*') -DestinationPath $firefoxZip -Force

Remove-Item $build -Recurse -Force

Get-FileHash $chromeZip, $firefoxZip -Algorithm SHA256 |
  ForEach-Object { "$($_.Hash)  $([System.IO.Path]::GetFileName($_.Path))" } |
  Set-Content -Path (Join-Path $dist 'SHA256SUMS.txt') -Encoding ASCII

Get-ChildItem $dist | Select-Object Name, Length
