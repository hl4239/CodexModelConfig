Add-Type -AssemblyName System.Drawing
$taskOutput = Join-Path $PSScriptRoot '..\desktop\assets'
[System.IO.Directory]::CreateDirectory($taskOutput) | Out-Null
$taskBitmap = New-Object System.Drawing.Bitmap 256,256
$taskGraphics = [System.Drawing.Graphics]::FromImage($taskBitmap)
$taskGraphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$taskPath = New-Object System.Drawing.Drawing2D.GraphicsPath
$taskPath.AddArc(8,8,72,72,180,90)
$taskPath.AddArc(176,8,72,72,270,90)
$taskPath.AddArc(176,176,72,72,0,90)
$taskPath.AddArc(8,176,72,72,90,90)
$taskPath.CloseFigure()
$taskBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.ColorTranslator]::FromHtml('#263f35'))
$taskGraphics.FillPath($taskBrush,$taskPath)
$taskPen = New-Object System.Drawing.Pen ([System.Drawing.ColorTranslator]::FromHtml('#d8f1a0')),15
$taskPen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
$taskPen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
$taskPen.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round
$taskGraphics.DrawLines($taskPen,[System.Drawing.Point[]]@((New-Object System.Drawing.Point 99,80),(New-Object System.Drawing.Point 51,128),(New-Object System.Drawing.Point 99,176)))
$taskGraphics.DrawLines($taskPen,[System.Drawing.Point[]]@((New-Object System.Drawing.Point 157,80),(New-Object System.Drawing.Point 205,128),(New-Object System.Drawing.Point 157,176)))
$taskPngPath = Join-Path $taskOutput 'icon.png'
$taskBitmap.Save($taskPngPath,[System.Drawing.Imaging.ImageFormat]::Png)
$taskGraphics.Dispose(); $taskBitmap.Dispose(); $taskBrush.Dispose(); $taskPen.Dispose(); $taskPath.Dispose()
$taskPng = [System.IO.File]::ReadAllBytes($taskPngPath)
$taskStream = [System.IO.File]::Create((Join-Path $taskOutput 'icon.ico'))
$taskWriter = New-Object System.IO.BinaryWriter $taskStream
$taskWriter.Write([uint16]0); $taskWriter.Write([uint16]1); $taskWriter.Write([uint16]1)
$taskWriter.Write([byte]0); $taskWriter.Write([byte]0); $taskWriter.Write([byte]0); $taskWriter.Write([byte]0)
$taskWriter.Write([uint16]1); $taskWriter.Write([uint16]32); $taskWriter.Write([uint32]$taskPng.Length); $taskWriter.Write([uint32]22)
$taskWriter.Write($taskPng); $taskWriter.Dispose()
