package authremediation

import (
	"encoding/binary"
	"testing"

	"github.com/jackc/pgproto3/v2"
)

func decodeSafely(t *testing.T, data []byte) error {
	t.Helper()
	defer func() { if v := recover(); v != nil { t.Errorf("decoder panic: %v", v) } }()
	return (&pgproto3.DataRow{}).Decode(data)
}

func TestRejectNegativeLengths(t *testing.T) {
	for _, n := range []uint32{0xfffffffe, 0x80000000, 0xfffffff0} {
		data := []byte{0, 1, 0, 0, 0, 0}
		binary.BigEndian.PutUint32(data[2:], n)
		if err := decodeSafely(t, data); err == nil { t.Errorf("expected error for field length %x", n) }
	}
}

func TestValidAndTruncatedRows(t *testing.T) {
	for _, data := range [][]byte{{0,0}, {0,1,255,255,255,255}, {0,1,0,0,0,0}, {0,1,0,0,0,1,65}} {
		if err := decodeSafely(t, data); err != nil { t.Errorf("valid row rejected: %v", err) }
	}
	for _, data := range [][]byte{{}, {0}, {0,1}, {0,1,0,0,0}, {0,1,0,0,0,2,65}, {0,1,127,255,255,255}} {
		if err := decodeSafely(t, data); err == nil { t.Errorf("truncated row accepted: %x", data) }
	}
}

func FuzzDataRowNeverPanics(f *testing.F) {
	for _, data := range [][]byte{{0,1,255,255,255,254},{0,1,128,0,0,0},{0,1,255,255,255,255},{0,0}} { f.Add(data) }
	f.Fuzz(func(t *testing.T, data []byte) { decodeSafely(t, data) })
}
