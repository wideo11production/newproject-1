//go:build linux
// +build linux

// Disk usage check - sirf LINUX pe compile hota hai
//
// KYUN BUILD TAG:
// "golang.org/x/sys/unix" ka Statfs() sirf Unix-like OS me available hai.
// Windows/macOS pe ye package exist nahi karta ya different API deta hai - jiski
// wajah se `go build ./...` Windows dev machine par FAIL hota tha:
//   "undefined: unix.Statfs_t"
// Isliye actual statfs call ko build-tag wali file me isolate kiya hai.
// GKE container Linux hai, to production me ye actively kaam karta hai.
//
// Hinglish: ye sirf Linux me compile hota hai - Windows pe skip ho jata hai

package pvc

import "golang.org/x/sys/unix"

// diskUsage filesystem ka total aur used space (GB me) deta hai
// ok=false agar path stat nahi ho paya
func diskUsage(path string) (totalGB int64, usedGB int64, ok bool) {
	var stat unix.Statfs_t
	if err := unix.Statfs(path, &stat); err != nil {
		return 0, 0, false
	}

	blockSize := uint64(stat.Bsize)
	totalGB = int64(stat.Blocks * blockSize / (1024 * 1024 * 1024))
	usedGB = int64((stat.Blocks - stat.Bfree) * blockSize / (1024 * 1024 * 1024))

	return totalGB, usedGB, true
}
