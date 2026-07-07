
<?php
/**
 * Enhanced Update Progress API with sync tracking
 */

include 'db.php';

header('Content-Type: application/json');

// Only accept POST requests
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(['success' => false, 'error' => 'Method not allowed']);
    exit;
}

// Get POST data
$input = json_decode(file_get_contents('php://input'), true);
if (!$input) {
    $input = $_POST;
}

// Validate input
if (!isset($input['id']) || !isset($input['completed'])) {
    http_response_code(400);
    echo json_encode(['success' => false, 'error' => 'Missing required fields']);
    exit;
}

$id = (int)$input['id'];
$completed = (int)$input['completed'];
$deviceId = $input['device_id'] ?? ($_SERVER['HTTP_USER_AGENT'] ?? 'unknown');

try {
    // Update progress with sync tracking
    $stmt = $conn->prepare("
        UPDATE progress 
        SET completed = ?, 
            sync_status = 'synced',
            last_sync = NOW(),
            device_id = ?
        WHERE id = ?
    ");
    $stmt->bind_param("isi", $completed, $deviceId, $id);
    
    if ($stmt->execute()) {
        if ($stmt->affected_rows > 0) {
            echo json_encode([
                'success' => true,
                'message' => 'Progress updated and synced',
                'id' => $id,
                'completed' => $completed,
                'synced_at' => date('Y-m-d H:i:s')
            ]);
        } else {
            // Mark as pending if no rows affected (might be offline update)
            $stmt2 = $conn->prepare("
                UPDATE progress 
                SET sync_status = 'pending',
                    device_id = ?
                WHERE id = ?
            ");
            $stmt2->bind_param("si", $deviceId, $id);
            $stmt2->execute();
            $stmt2->close();
            
            echo json_encode([
                'success' => true,
                'message' => 'Update marked as pending',
                'id' => $id,
                'completed' => $completed,
                'synced' => false
            ]);
        }
    } else {
        throw new Exception('Database update failed');
    }
    
    $stmt->close();
    
} catch (Exception $e) {
    http_response_code(500);
    echo json_encode([
        'success' => false,
        'error' => 'Server error: ' . $e->getMessage()
    ]);
} finally {
    if (isset($conn)) {
        $conn->close();
    }
}
?>
