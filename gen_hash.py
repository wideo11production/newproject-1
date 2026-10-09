import bcrypt
pw = b"Rajaghenna123*#"
print(bcrypt.hashpw(pw, bcrypt.gensalt(12)).decode())