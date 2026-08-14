# Copy-paste in PowerShell:
#   irm https://raw.githubusercontent.com/XreeceX/GTimed/master/scripts/install.ps1 | iex
$ErrorActionPreference = "Stop"

$repo = if ($env:GTIMED_REPO) { $env:GTIMED_REPO } else { "XreeceX/GTimed" }
$ref = if ($env:GTIMED_INSTALL_REF) { $env:GTIMED_INSTALL_REF } else { "master" }

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Error "GTimed needs Node.js 18 or newer. Install it from https://nodejs.org then paste this command again."
}
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
  Write-Error "GTimed needs npm (it comes with Node.js). Install Node from https://nodejs.org then paste this command again."
}

$url = "https://raw.githubusercontent.com/$repo/$ref/scripts/install.mjs"
$tmp = Join-Path ([System.IO.Path]::GetTempPath()) ("gtimed-install-" + [guid]::NewGuid().ToString() + ".mjs")
try {
  Invoke-WebRequest -UseBasicParsing -Uri $url -OutFile $tmp
  Write-Host "Installing GTimed from GitHub ($repo@$ref)..."
  & node $tmp @args
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}
finally {
  if (Test-Path $tmp) { Remove-Item $tmp -Force -ErrorAction SilentlyContinue }
}
