# Optional Windows fallback when npm's Electron binary downloader is unavailable.
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$taskRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$taskVersion = (Get-Content -LiteralPath (Join-Path $taskRoot 'node_modules\electron\package.json') -Raw | ConvertFrom-Json).version
$taskArchiveName = "electron-v$taskVersion-win32-x64.zip"
$taskArchiveUrl = "https://github.com/electron/electron/releases/download/v$taskVersion/$taskArchiveName"
$taskOutput = Join-Path $taskRoot '.test-data\electron-parts'
[System.IO.Directory]::CreateDirectory($taskOutput) | Out-Null
$taskHead = Invoke-WebRequest -Uri $taskArchiveUrl -Method Head -TimeoutSec 30
$taskLength = [long]($taskHead.Headers['Content-Length'] | Select-Object -First 1)
if ($taskLength -le 0) { throw 'No archive length returned' }
$taskChunkSize = 2MB
$taskCount = [int][Math]::Ceiling($taskLength / $taskChunkSize)
0..($taskCount - 1) | ForEach-Object -Parallel {
  $ProgressPreference = 'SilentlyContinue'
  $taskIndex = $_
  $taskStart = [long]$taskIndex * $using:taskChunkSize
  $taskEnd = [Math]::Min($taskStart + $using:taskChunkSize - 1, $using:taskLength - 1)
  $taskFile = Join-Path $using:taskOutput ('chunk-{0:D3}.bin' -f $taskIndex)
  $taskExpectedRange = "bytes $taskStart-$taskEnd/$using:taskLength"
  for ($taskAttempt = 0; $taskAttempt -lt 3; $taskAttempt++) {
    try {
      $taskResult = Invoke-WebRequest -Uri $using:taskArchiveUrl -Headers @{Range="bytes=$taskStart-$taskEnd"} -OutFile $taskFile -PassThru -TimeoutSec 60
      if ($taskResult.StatusCode -ne 206 -or [string]$taskResult.Headers['Content-Range'] -ne $taskExpectedRange -or (Get-Item -LiteralPath $taskFile).Length -ne ($taskEnd - $taskStart + 1)) { throw "Invalid range response for part $taskIndex" }
      return
    } catch { if ($taskAttempt -eq 2) { throw } }
  }
} -ThrottleLimit 16
$taskArchive = Join-Path $taskOutput $taskArchiveName
$taskDestination = [System.IO.File]::Create($taskArchive)
try {
  for ($taskIndex = 0; $taskIndex -lt $taskCount; $taskIndex++) {
    $taskSource = [System.IO.File]::OpenRead((Join-Path $taskOutput ('chunk-{0:D3}.bin' -f $taskIndex)))
    try { $taskSource.CopyTo($taskDestination) } finally { $taskSource.Dispose() }
  }
} finally { $taskDestination.Dispose() }
$taskExpectedHash = (Get-Content -LiteralPath (Join-Path $taskRoot 'node_modules\electron\checksums.json') -Raw | ConvertFrom-Json).$taskArchiveName
$taskActualHash = (Get-FileHash -LiteralPath $taskArchive -Algorithm SHA256).Hash.ToLowerInvariant()
if ($taskActualHash -ne $taskExpectedHash) { throw 'Electron archive checksum mismatch' }
Write-Output "Verified Electron $taskVersion archive: $taskActualHash"
Expand-Archive -LiteralPath $taskArchive -DestinationPath (Join-Path $taskRoot 'node_modules\electron\dist') -Force
[System.IO.File]::WriteAllText((Join-Path $taskRoot 'node_modules\electron\path.txt'), 'electron.exe')
Write-Output 'Electron runtime ready.'
