# Raster sizes of the existing public/favicon.svg J mark (no external assets).
Add-Type -AssemblyName System.Drawing
$taskRoot = Split-Path -Parent $PSScriptRoot
foreach ($taskSize in @(180, 192, 512)) {
  $taskBitmap = New-Object System.Drawing.Bitmap($taskSize, $taskSize)
  $taskGraphics = [System.Drawing.Graphics]::FromImage($taskBitmap)
  $taskGraphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $taskGraphics.Clear([System.Drawing.ColorTranslator]::FromHtml('#294e3e'))
  $taskGraphics.ScaleTransform($taskSize / 32.0, $taskSize / 32.0)
  $taskPen = New-Object System.Drawing.Pen([System.Drawing.Color]::White, 3.5)
  $taskPen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
  $taskPen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
  $taskPen.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round
  $taskGraphics.DrawLine($taskPen, 13, 8, 22, 8)
  $taskPath = New-Object System.Drawing.Drawing2D.GraphicsPath
  $taskPath.AddLine(19, 8, 19, 20)
  $taskPath.AddBezier(19, 20, 19, 23, 17, 25, 14, 25)
  $taskPath.AddBezier(14, 25, 11, 25, 9, 23, 9, 20)
  $taskGraphics.DrawPath($taskPen, $taskPath)
  $taskName = if ($taskSize -eq 180) { 'apple-touch-icon.png' } else { "icon-$taskSize.png" }
  $taskBitmap.Save((Join-Path $taskRoot "public/$taskName"), [System.Drawing.Imaging.ImageFormat]::Png)
  $taskPath.Dispose(); $taskPen.Dispose(); $taskGraphics.Dispose(); $taskBitmap.Dispose()
}
