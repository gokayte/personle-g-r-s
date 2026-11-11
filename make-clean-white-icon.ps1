Add-Type -AssemblyName System.Drawing
$userUpload = "C:\Users\Gokay\Desktop\personel-pdks\public\user-star-logo.png"
$src = New-Object System.Drawing.Bitmap($userUpload)

# 1. Clean background to pure white or transparency
# Any pixel that is darkish (near R=30, G=33, B=32, or R < 90, G < 90, B < 90) make transparent or white
$cleaned = New-Object System.Drawing.Bitmap($src.Width, $src.Height)

for ($x = 0; $x -lt $src.Width; $x++) {
    for ($y = 0; $y -lt $src.Height; $y++) {
        $pixel = $src.GetPixel($x, $y)
        # Red logo pixels are high R, low G, low B (R > 140, G < 100, B < 100) or white stars inside
        $isRedOrWhite = ($pixel.R -gt 130 -and $pixel.R -gt ($pixel.G * 1.5)) -or ($pixel.R -gt 200 -and $pixel.G -gt 200 -and $pixel.B -gt 200)
        
        if ($isRedOrWhite) {
            $cleaned.SetPixel($x, $y, $pixel)
        } else {
            $cleaned.SetPixel($x, $y, [System.Drawing.Color]::FromArgb(0, 0, 0, 0))
        }
    }
}

# 2. Render onto crisp solid White background 512x512
$size = 512
$bmp = New-Object System.Drawing.Bitmap($size, $size)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
$g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality

# Pure white background
$whiteBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::White)
$g.FillRectangle($whiteBrush, 0, 0, $size, $size)

# Scale cleaned star to 380px centered
$scale = [Math]::Min(390.0 / $src.Width, 390.0 / $src.Height)
$w = [int]($src.Width * $scale)
$h = [int]($src.Height * $scale)
$dx = [int](($size - $w) / 2)
$dy = [int](($size - $h) / 2)

$g.DrawImage($cleaned, $dx, $dy, $w, $h)

$bmp.Save("C:\Users\Gokay\Desktop\personel-pdks\public\apple-touch-icon.png", [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Save("C:\Users\Gokay\Desktop\personel-pdks\public\icon-512.png", [System.Drawing.Imaging.ImageFormat]::Png)

$src.Dispose()
$cleaned.Dispose()
$bmp.Dispose()
$g.Dispose()
Write-Host "Clean white-background icon created successfully!"
