package codec

import (
	"encoding/json"
)

func Encode(v interface{}) ([]byte, error) {
	return json.Marshal(v)
}

func Decode(data []byte, v interface{}) error {
	return json.Unmarshal(data, v)
}
