Add-Type -AssemblyName System.Drawing
$size = 512
$bmp = New-Object System.Drawing.Bitmap($size, $size)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
$g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality

# Background dark premium slate / black
$bgBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 11, 13, 19))
$g.FillRectangle($bgBrush, 0, 0, $size, $size)

# Draw central All Stars iconic star with red brand accent #ee3623
$redBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 238, 54, 35))

# Create 5-point star centered at 256, 256
$cx = 256.0
$cy = 256.0
$outerR = 190.0
$innerR = 82.0
$pts = New-Object 'System.Drawing.PointF[]' 10

for ($i = 0; $i -lt 10; $i++) {
    $angle = ($i * 36 - 90) * [Math]::PI / 180.0
    $r = if ($i % 2 -eq 0) { $outerR } else { $innerR }
    $px = [float]($cx + $r * [Math]::Cos($angle))
    $py = [float]($cy + $r * [Math]::Sin($angle))
    $pts[$i] = New-Object System.Drawing.PointF($px, $py)
}

$g.FillPolygon($redBrush, $pts)

# Inner small black star detail
$innerStarPts = New-Object 'System.Drawing.PointF[]' 10
$innerOuterR = 54.0
$innerInnerR = 24.0
for ($i = 0; $i -lt 10; $i++) {
    $angle = ($i * 36 - 90) * [Math]::PI / 180.0
    $r = if ($i % 2 -eq 0) { $innerOuterR } else { $innerInnerR }
    $px = [float]($cx + $r * [Math]::Cos($angle))
    $py = [float]($cy + $r * [Math]::Sin($angle))
    $innerStarPts[$i] = New-Object System.Drawing.PointF($px, $py)
}
$g.FillPolygon($bgBrush, $innerStarPts)

$bmp.Save("C:\Users\Gokay\Desktop\personel-pdks\public\apple-touch-icon.png", [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Save("C:\Users\Gokay\Desktop\personel-pdks\public\icon-512.png", [System.Drawing.Imaging.ImageFormat]::Png)

$bmp.Dispose()
$g.Dispose()
Write-Host "Star icon created successfully!"
