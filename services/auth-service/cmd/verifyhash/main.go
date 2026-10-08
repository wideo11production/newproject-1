package main

import (
	"fmt"

	"golang.org/x/crypto/bcrypt"
)

func main() {
	// Verify the hash matches the password
	password := "Appp Rajaghenna123*#"
	hash := "$2a$12$Nk5RPdXgQJ5SM/FCj.kpkOEduXKpgeKLatY0hL2bFyM2hJATRGg8G"
	err := bcrypt.CompareHashAndPassword([]byte(hash), []byte(password))
	if err != nil {
		fmt.Println("MISMATCH:", err)
	} else {
		fmt.Println("MATCH: password verified successfully")
	}
}