Add-Type -AssemblyName System.Drawing
$userUpload = "C:\Users\Gokay\Desktop\personel-pdks\public\user-star-logo.png"
$src = New-Object System.Drawing.Bitmap($userUpload)

# 1. Clean star logo pixels
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

# 2. Render onto solid Black background 512x512
$size = 512
$bmp = New-Object System.Drawing.Bitmap($size, $size)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
$g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
$g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality

# Pure black background #0b0d13
$blackBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 11, 13, 19))
$g.FillRectangle($blackBrush, 0, 0, $size, $size)

# BÜYÜTÜLMÜŞ LOGO (335px):
$starSize = 335.0
$scale = [Math]::Min($starSize / $src.Width, $starSize / $src.Height)
$w = [int]($src.Width * $scale)
$h = [int]($src.Height * $scale)
$dx = [int](($size - $w) / 2)
$dy = 26

$g.DrawImage($cleaned, $dx, $dy, $w, $h)

# BÜYÜK YAZILAR:
# "ALL STARS" kırmızı ve büyük (50px)
$fontFamily = New-Object System.Drawing.FontFamily("Arial Black")
$font = New-Object System.Drawing.Font($fontFamily, 50, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
$redBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 238, 54, 35))

$sf = New-Object System.Drawing.StringFormat
$sf.Alignment = [System.Drawing.StringAlignment]::Center
$sf.LineAlignment = [System.Drawing.StringAlignment]::Center

$textRect = New-Object System.Drawing.RectangleF(0, 368, 512, 65)
$g.DrawString("ALL STARS", $font, $redBrush, $textRect, $sf)

# "MUSIC" beyaz ve net (24px)
$subFont = New-Object System.Drawing.Font("Arial Black", 24, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
$whiteBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::White)
$subTextRect = New-Object System.Drawing.RectangleF(0, 440, 512, 36)
$g.DrawString("MUSIC", $subFont, $whiteBrush, $subTextRect, $sf)

$bmp.Save("C:\Users\Gokay\Desktop\personel-pdks\public\apple-touch-icon.png", [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Save("C:\Users\Gokay\Desktop\personel-pdks\public\icon-512.png", [System.Drawing.Imaging.ImageFormat]::Png)

$src.Dispose()
$cleaned.Dispose()
$bmp.Dispose()
$g.Dispose()
Write-Host "Black background enlarged icon created successfully!"
