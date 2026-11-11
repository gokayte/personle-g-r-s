Add-Type -AssemblyName System.Drawing
$userUpload = "C:\Users\Gokay\Desktop\personel-pdks\public\user-star-logo.png"
$src = New-Object System.Drawing.Bitmap($userUpload)

# Clean star logo pixels
$cleaned = New-Object System.Drawing.Bitmap($src.Width, $src.Height)
for ($x = 0; $x -lt $src.Width; $x++) {
    for ($y = 0; $y -lt $src.Height; $y++) {
        $pixel = $src.GetPixel($x, $y)
        $isRedOrWhite = ($pixel.R -gt 130 -and $pixel.R -gt ($pixel.G * 1.5)) -or ($pixel.R -gt 200 -and $pixel.G -gt 200 -and $pixel.B -gt 200)
        if ($isRedOrWhite) {
            $cleaned.SetPixel($x, $y, $pixel)
        } else {
            $cleaned.SetPixel($x, $y, [System.Drawing.Color]::FromArgb(0, 0, 0, 0))
        }
    }
}

$size = 512
$bmp = New-Object System.Drawing.Bitmap($size, $size)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
$g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
$g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality

# Black background #0b0d13
$blackBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 11, 13, 19))
$g.FillRectangle($blackBrush, 0, 0, $size, $size)

# Scale star to 290px height, centered horizontally, starts at y = 14
$starH = 280.0
$scale = $starH / $src.Height
$w = [int]($src.Width * $scale)
$h = [int]($src.Height * $scale)
$dx = [int](($size - $w) / 2)
$dy = 14
$g.DrawImage($cleaned, $dx, $dy, $w, $h)

# BÜYÜK VE NET YAZILAR (Tüm genişliği kaplasın, telefonda ufacık simgede bile okunsun):
# "ALL STARS" -> 72px Arial Black
$fontFamily = New-Object System.Drawing.FontFamily("Arial Black")
$fontAllStars = New-Object System.Drawing.Font($fontFamily, 72, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
$redBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 238, 54, 35))

$sf = New-Object System.Drawing.StringFormat
$sf.Alignment = [System.Drawing.StringAlignment]::Center
$sf.LineAlignment = [System.Drawing.StringAlignment]::Center

$textRect = New-Object System.Drawing.RectangleF(0, 310, 512, 90)
$g.DrawString("ALL STARS", $fontAllStars, $redBrush, $textRect, $sf)

# "MUSIC" -> 50px Arial Black Pure White
$fontMusic = New-Object System.Drawing.Font($fontFamily, 50, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
$whiteBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::White)

$subRect = New-Object System.Drawing.RectangleF(0, 404, 512, 70)
$g.DrawString("MUSIC", $fontMusic, $whiteBrush, $subRect, $sf)

$bmp.Save("C:\Users\Gokay\Desktop\personel-pdks\public\apple-touch-icon.png", [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Save("C:\Users\Gokay\Desktop\personel-pdks\public\icon-512.png", [System.Drawing.Imaging.ImageFormat]::Png)

$src.Dispose()
$cleaned.Dispose()
$bmp.Dispose()
$g.Dispose()
Write-Host "Huge text icon generated successfully!"
