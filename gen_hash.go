package main

import (
	"fmt"
	"golang.org/x/crypto/bcrypt"
)

func main() {
	pw := "Rajaghenna123*#"
	hash, err := bcrypt.GenerateFromPassword([]byte(pw), 12)
	if err != nil {
		fmt.Println("Error:", err)
		return
	}
	fmt.Println(string(hash))
}