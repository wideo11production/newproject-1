//go:build !linux
// +build !linux

// Disk usage check - NON-LINUX platforms (Windows, macOS) ke liye
//
// Ye file tab compile hoti hai jab linux NAHI hai. Yahan hum actual disk check
// skip kar dete hain aur ok=false return karte hain, jisse rotation engine
// gracefully aage badh jata hai (warning log karke).
//
// KYUN: taaki `go build ./...` har OS pe pass ho - sirf Linux me actual
// statfs call ho. Development Windows par hoti hai aur wahan build fail hona
// unacceptable hai.
//
// Hinglish: non-Linux pe disk check skip - build fail na ho

package pvc

// diskUsage non-Linux pe no-op hai
func diskUsage(path string) (totalGB int64, usedGB int64, ok bool) {
	return 0, 0, false
}
