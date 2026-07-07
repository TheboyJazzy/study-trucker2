<?php
/**
 * Icon Generator for Study Tracker
 * Run once to create all required icons
 */

// Create icons directory if it doesn't exist
$iconsDir = __DIR__ . '/icons';
if (!is_dir($iconsDir)) {
    mkdir($iconsDir, 0777, true);
}

// Icon sizes needed
$sizes = [72, 96, 128, 144, 152, 192, 384, 512];

echo "<!DOCTYPE html><html><head><title>Create Icons</title><style>
    body { font-family: Arial, sans-serif; padding: 20px; background: #f5f5f5; }
    .icon-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 20px; margin: 20px 0; }
    .icon-box { background: white; padding: 15px; border-radius: 10px; text-align: center; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
    .icon-img { border: 1px solid #ddd; margin-bottom: 10px; }
    .success { color: green; }
    .error { color: red; }
</style></head><body>";
echo "<h1>📱 Study Tracker Icon Generator</h1>";
echo "<p>Generating PWA icons for your application...</p>";

// Colors
$bgColor = [15, 23, 42];    // #0f172a
$bookColor = [79, 70, 229]; // #4f46e5
$textColor = [255, 255, 255];

$created = 0;
$failed = 0;

foreach ($sizes as $size) {
    $image = imagecreatetruecolor($size, $size);
    
    // Allocate colors
    $backgroundColor = imagecolorallocate($image, $bgColor[0], $bgColor[1], $bgColor[2]);
    $bookFillColor = imagecolorallocate($image, $bookColor[0], $bookColor[1], $bookColor[2]);
    $textFillColor = imagecolorallocate($image, $textColor[0], $textColor[1], $textColor[2]);
    
    // Fill background
    imagefilledrectangle($image, 0, 0, $size, $size, $backgroundColor);
    
    // Draw book (simplified)
    $padding = $size * 0.15;
    $bookWidth = $size - ($padding * 2);
    $bookHeight = $bookWidth * 0.8;
    
    // Book cover
    imagefilledrectangle($image, $padding, $padding, $padding + $bookWidth, $padding + $bookHeight, $bookFillColor);
    
    // Book pages (offset)
    $pageOffset = $size * 0.04;
    imagefilledrectangle($image, $padding + $pageOffset, $padding, $padding + $bookWidth, $padding + $bookHeight, 
        imagecolorallocate($image, 99, 102, 241)); // Lighter blue
    
    // Book lines (pages)
    $lineColor = imagecolorallocate($image, 199, 210, 254);
    $lineCount = 6;
    $lineSpacing = $bookHeight / ($lineCount + 1);
    for ($i = 1; $i <= $lineCount; $i++) {
        $y = $padding + ($lineSpacing * $i);
        imageline($image, $padding + $pageOffset + 10, $y, $padding + $bookWidth - 10, $y, $lineColor);
    }
    
    // Draw "ST" text for larger icons
    if ($size >= 128) {
        $fontSize = $size * 0.15;
        $font = 5; // Built-in GD font
        
        $text = "ST";
        $textWidth = imagefontwidth($font) * strlen($text);
        $textX = $padding + ($bookWidth / 2) - ($textWidth / 2);
        $textY = $padding + ($bookHeight / 2) - (imagefontheight($font) / 2);
        
        imagestring($image, $font, $textX, $textY, $text, $textFillColor);
    }
    
    // Save image
    $filename = $iconsDir . "/icon-{$size}.png";
    
    if (imagepng($image, $filename, 9)) {
        $status = "<span class='success'>✅ Created</span>";
        $created++;
    } else {
        $status = "<span class='error'>❌ Failed</span>";
        $failed++;
    }
    
    imagedestroy($image);
    
    // Show preview
    $data = file_get_contents($filename);
    $base64 = base64_encode($data);
    
    echo "<div class='icon-box'>
        <img src='data:image/png;base64,{$base64}' alt='{$size}x{$size}' class='icon-img' width='64' height='64'>
        <div><strong>icon-{$size}.png</strong></div>
        <div>{$size}x{$size}px</div>
        <div>{$status}</div>
    </div>";
}

echo "</div>";

if ($failed === 0) {
    echo "<h2 class='success'>✅ Successfully created {$created} icons!</h2>";
    echo "<p>All icons have been saved to the <code>/icons</code> folder.</p>";
} else {
    echo "<h2 class='error'>⚠️ Created {$created} icons, {$failed} failed</h2>";
}

echo "<p><a href='index.html'>← Back to Study Tracker</a></p>";
echo "</body></html>";
?>