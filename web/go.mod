// Module boundary keeps optional npm dependencies out of root go ./... scans.
// The frontend contains no Go application and does not import this module.
module market-dragon/frontend-boundary

go 1.25.0
