Add-Type -AssemblyName System.Drawing
$srcPath = "C:\Users\Gokay\Desktop\personel-pdks\public\allstar-logo.png"
$src = [System.Drawing.Image]::FromFile($srcPath)
$size = 512
$bmp = New-Object System.Drawing.Bitmap($size, $size)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
$g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality

$brush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 255, 255, 255))
$g.FillRectangle($brush, 0, 0, $size, $size)

$targetW = 460
$targetH = [int](252 * (460.0 / 1000.0))
$x = [int](($size - $targetW) / 2)
$y = [int](($size - $targetH) / 2)

$g.DrawImage($src, $x, $y, $targetW, $targetH)

$bmp.Save("C:\Users\Gokay\Desktop\personel-pdks\public\apple-touch-icon.png", [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Save("C:\Users\Gokay\Desktop\personel-pdks\public\icon-512.png", [System.Drawing.Imaging.ImageFormat]::Png)

$src.Dispose()
$bmp.Dispose()
$g.Dispose()
Write-Host "Icons generated successfully!"
