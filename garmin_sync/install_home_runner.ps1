# ─────────────────────────────────────────────────────────────────────────────
# Garmin Dashboard — GitHub Actions Self-Hosted Runner Installer
# Run this ONCE on your home desktop (NOT on Walmart VPN).
#
# What it does:
#   1. Downloads the GitHub Actions runner
#   2. Configures it for davelane26/weight-dashboard-v2
#   3. Installs it as a Windows Service (auto-starts on boot)
#
# Usage:
#   Right-click → "Run with PowerShell"  (or: powershell -ExecutionPolicy Bypass -File install_home_runner.ps1)
# ─────────────────────────────────────────────────────────────────────────────

$REPO_URL  = "https://github.com/davelane26/weight-dashboard-v2"
$REPO_NAME = "davelane26/weight-dashboard-v2"
$RUNNER_DIR = "$env:USERPROFILE\garmin-runner"
$SERVICE_NAME = "GarminGitHubRunner"

Write-Host ""
Write-Host "  =====================================================" -ForegroundColor Cyan
Write-Host "   Garmin Dashboard — GitHub Runner Installer" -ForegroundColor Cyan
Write-Host "  =====================================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "  This installs a GitHub Actions runner on this PC."
Write-Host "  The runner will sync your Garmin data automatically."
Write-Host ""

# ── Step 1: Get runner registration token ────────────────────────────────────
Write-Host "  STEP 1 — Get your runner token from GitHub:" -ForegroundColor Yellow
Write-Host ""
Write-Host "  1. Open this URL in a browser:" -ForegroundColor White
Write-Host "     https://github.com/$REPO_NAME/settings/actions/runners/new?runnerOs=windows" -ForegroundColor Green
Write-Host ""
Write-Host "  2. Scroll down to the 'Configure' section"
Write-Host "  3. Find the line:  ./config.cmd --url ... --token XXXXX"
Write-Host "  4. Copy just the token (the big string after --token)"
Write-Host ""
$TOKEN = Read-Host "  Paste your runner token here"

if (-not $TOKEN -or $TOKEN.Length -lt 10) {
    Write-Host "" 
    Write-Host "  ❌ Token looks invalid. Try again." -ForegroundColor Red
    exit 1
}

# ── Step 2: Download the runner ───────────────────────────────────────────────
Write-Host ""
Write-Host "  STEP 2 — Downloading GitHub Actions runner..." -ForegroundColor Yellow

# Fetch latest runner version from GitHub API
try {
    $release = Invoke-RestMethod "https://api.github.com/repos/actions/runner/releases/latest" -TimeoutSec 30
    $version = $release.tag_name.TrimStart("v")
    Write-Host "  Latest runner version: $version"
} catch {
    # Fallback to known-good version
    $version = "2.317.0"
    Write-Host "  Could not fetch latest version, using $version"
}

$DOWNLOAD_URL = "https://github.com/actions/runner/releases/download/v$version/actions-runner-win-x64-$version.zip"
$ZIP_PATH = "$env:TEMP\actions-runner.zip"

if (Test-Path $RUNNER_DIR) {
    Write-Host "  Runner directory already exists, cleaning up..."
    Remove-Item $RUNNER_DIR -Recurse -Force
}

New-Item -ItemType Directory -Path $RUNNER_DIR -Force | Out-Null
Write-Host "  Downloading from: $DOWNLOAD_URL"

try {
    Invoke-WebRequest -Uri $DOWNLOAD_URL -OutFile $ZIP_PATH -UseBasicParsing -TimeoutSec 120
} catch {
    Write-Host ""
    Write-Host "  ❌ Download failed: $_" -ForegroundColor Red
    Write-Host "  Check your internet connection and try again."
    exit 1
}

Write-Host "  Extracting..."
Expand-Archive -Path $ZIP_PATH -DestinationPath $RUNNER_DIR -Force
Remove-Item $ZIP_PATH -Force
Write-Host "  ✅ Runner downloaded to $RUNNER_DIR" -ForegroundColor Green

# ── Step 3: Configure the runner ─────────────────────────────────────────────
Write-Host ""
Write-Host "  STEP 3 — Configuring runner..." -ForegroundColor Yellow

Set-Location $RUNNER_DIR

# Run config.cmd (non-interactively)
$configArgs = @(
    "--url",   $REPO_URL,
    "--token", $TOKEN,
    "--name",  "$env:COMPUTERNAME-garmin",
    "--labels","home-pc,garmin",
    "--work",  "_work",
    "--unattended",
    "--replace"
)

& "$RUNNER_DIR\config.cmd" @configArgs

if ($LASTEXITCODE -ne 0) {
    Write-Host ""
    Write-Host "  ❌ Runner config failed (exit code $LASTEXITCODE)." -ForegroundColor Red
    Write-Host "  Token may have expired (they last 1 hour). Get a fresh one and retry."
    exit 1
}

Write-Host "  ✅ Runner configured!" -ForegroundColor Green

# ── Step 4: Install as Windows Service ───────────────────────────────────────
Write-Host ""
Write-Host "  STEP 4 — Installing as Windows Service..." -ForegroundColor Yellow
Write-Host "  (This means it auto-starts on boot — you never have to touch it)"

& "$RUNNER_DIR\svc.cmd" install
& "$RUNNER_DIR\svc.cmd" start

if ($LASTEXITCODE -eq 0) {
    Write-Host "  ✅ Service installed and started!" -ForegroundColor Green
} else {
    Write-Host "  ⚠️  Service install failed. Try running as Administrator." -ForegroundColor Yellow
    Write-Host "  You can still run the runner manually: $RUNNER_DIR\run.cmd"
}

# ── Done! ─────────────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "  =====================================================" -ForegroundColor Green
Write-Host "   ✅  All done! Runner is live." -ForegroundColor Green
Write-Host "  =====================================================" -ForegroundColor Green
Write-Host ""
Write-Host "  The runner will now pick up Garmin sync jobs from GitHub." -ForegroundColor White
Write-Host "  Check status here:" -ForegroundColor White
Write-Host "  https://github.com/$REPO_NAME/settings/actions/runners" -ForegroundColor Green
Write-Host ""
Write-Host "  Trigger a manual sync here:" -ForegroundColor White
Write-Host "  https://github.com/$REPO_NAME/actions" -ForegroundColor Green
Write-Host ""
Write-Host "  To uninstall later:" -ForegroundColor DarkGray
Write-Host "    cd $RUNNER_DIR" -ForegroundColor DarkGray
Write-Host "    .\svc.cmd stop" -ForegroundColor DarkGray
Write-Host "    .\svc.cmd uninstall" -ForegroundColor DarkGray
Write-Host "    .\config.cmd remove --token <new-token>" -ForegroundColor DarkGray
Write-Host ""

Read-Host "  Press Enter to close"
