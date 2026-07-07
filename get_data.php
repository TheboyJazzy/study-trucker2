<?php
/**
 * Get Study Data API
 * Returns JSON data for all weeks and days
 */

include 'db.php';

// Set JSON header
header('Content-Type: application/json');

try {
    $weeks = [];
    
    // Get data for 4 weeks
    for ($week = 1; $week <= 4; $week++) {
        // Count completed days for this week
        $completedQuery = $conn->prepare("SELECT COUNT(*) AS done FROM progress WHERE week = ? AND completed = 1");
        $completedQuery->bind_param("i", $week);
        $completedQuery->execute();
        $completedResult = $completedQuery->get_result();
        $completed = $completedResult->fetch_assoc()['done'];
        $completedQuery->close();
        
        // Calculate percentage (6 days per week)
        $total = 6; // Fixed 6 days per week
        $percentage = $total > 0 ? round(($completed / $total) * 100) : 0;
        
        // Get days for this week
        $daysQuery = $conn->prepare("SELECT * FROM progress WHERE week = ? ORDER BY day");
        $daysQuery->bind_param("i", $week);
        $daysQuery->execute();
        $daysResult = $daysQuery->get_result();
        
        $days = [];
        while ($row = $daysResult->fetch_assoc()) {
            $days[] = [
                'id' => (int)$row['id'],
                'day' => htmlspecialchars($row['day']),
                'subject' => htmlspecialchars($row['subject']),
                'completed' => (bool)$row['completed'],
                'week' => (int)$row['week']
            ];
        }
        $daysQuery->close();
        
        $weeks[] = [
            'week' => $week,
            'percentage' => $percentage,
            'days' => $days
        ];
    }
    
    // Return JSON response
    echo json_encode($weeks, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE);
    
} catch (Exception $e) {
    http_response_code(500);
    echo json_encode([
        'success' => false,
        'error' => 'Server error: ' . $e->getMessage()
    ], JSON_PRETTY_PRINT);
} finally {
    if (isset($conn)) {
        $conn->close();
    }
}
?>