import hashlib
import json
import os
import struct
import tempfile
import unittest
import unittest.mock
import zlib
import zipfile
from datetime import datetime, timezone
from pathlib import Path

from scripts.inspect_archives import ArchiveError, validate_bom


def fake_pe_x64() -> bytes:
    data = bytearray(256)
    data[:2] = b"MZ"
    struct.pack_into("<I", data, 0x3C, 0x80)
    data[0x80:0x84] = b"PE\0\0"
    struct.pack_into("<H", data, 0x84, 0x8664)
    return bytes(data)


class ArchiveTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.archive = self.root / "runtime.zip"

    def tearDown(self):
        self.temp.cleanup()

    def make_zip(self, members=None):
        members = members or {"bin/runtime.exe": fake_pe_x64(), "LICENSE.txt": b"MIT\n"}
        with zipfile.ZipFile(self.archive, "w", zipfile.ZIP_DEFLATED) as stream:
            for name, data in members.items():
                stream.writestr(name, data)

    def bom(self):
        blob = self.archive.read_bytes()
        return {
            "schema_version": 1,
            "sequence": 2,
            "generated_at": "2026-08-30T00:00:00Z",
            "repository_commit": "a" * 40,
            "release_tag": "runtime-v1.0.0",
            "runtimes": [{
                "id": "test-runtime", "version": "1.0.0", "platform": "windows", "architecture": "x64", "backend": "cpu", "accelerator": "none",
                "entrypoints": ["bin/runtime.exe"],
                "archive": {"name": "runtime.zip", "url": "https://github.com/makekosmos/engine-addons/releases/download/runtime-v1.0.0/runtime.zip", "size": len(blob), "sha256": hashlib.sha256(blob).hexdigest(), "format": "zip", "files": ["bin/runtime.exe", "LICENSE.txt"]},
                "source": {"project": "example", "version": "1.0.0", "commit": "b" * 40},
                "build": {"recipe": "build.ps1", "toolchain": "msvc-19.40"},
                "licences": [{"spdx": "MIT", "path": "LICENSE.txt"}]
            }]
        }

    def test_accepts_exact_safe_archive(self):
        self.make_zip()
        self.assertEqual(validate_bom(self.bom(), self.root, now=datetime(2026, 8, 30, 0, 1, tzinfo=timezone.utc))[0]["files"], 2)

    def test_rejects_traversal(self):
        self.make_zip({"../runtime.exe": fake_pe_x64(), "LICENSE.txt": b"MIT"})
        bom = self.bom()
        bom["runtimes"][0]["archive"]["files"] = ["../runtime.exe", "LICENSE.txt"]
        bom["runtimes"][0]["entrypoints"] = ["../runtime.exe"]
        with self.assertRaisesRegex(ArchiveError, "unsafe"):
            validate_bom(bom, self.root)

    def test_rejects_windows_ads_and_device_names(self):
        for bad_name in ("bin/runtime.exe:evil", "NUL.txt"):
            self.make_zip({bad_name: fake_pe_x64(), "LICENSE.txt": b"MIT"})
            bom = self.bom()
            bom["runtimes"][0]["archive"]["files"] = [bad_name, "LICENSE.txt"]
            bom["runtimes"][0]["entrypoints"] = [bad_name]
            with self.assertRaisesRegex(ArchiveError, "unsafe"):
                validate_bom(bom, self.root)

    def test_rejects_windows_reserved_chars_and_device_stem_whitespace(self):
        for bad_name in ("evil?.txt", "a*b.dll", "x<y>.dat", 'q"w".t', "p|q.t", "NUL .txt", "NUL  .txt", "AUX .dat", " NUL.txt", "COM1 .x", "a b.dll", "a#b.dll", "a%20b.dll", "a\tb.dll", "a-é.dll"):
            self.make_zip({"bin/runtime.exe": fake_pe_x64(), "LICENSE.txt": b"MIT", bad_name: b"x"})
            bom = self.bom()
            bom["runtimes"][0]["archive"]["files"].append(bad_name)
            with self.assertRaisesRegex(ArchiveError, "unsafe", msg=bad_name):
                validate_bom(bom, self.root)

    def test_rejects_unsupported_compression_method(self):
        self.make_zip()
        blob = bytearray(self.archive.read_bytes())
        offset = 0
        while True:
            offset = blob.find(b"PK\x03\x04", offset)
            if offset == -1:
                break
            name_length = struct.unpack_from("<H", blob, offset + 26)[0]
            if bytes(blob[offset + 30 : offset + 30 + name_length]) == b"LICENSE.txt":
                struct.pack_into("<H", blob, offset + 8, 9)
            offset += 4
        offset = 0
        while True:
            offset = blob.find(b"PK\x01\x02", offset)
            if offset == -1:
                break
            name_length = struct.unpack_from("<H", blob, offset + 28)[0]
            if bytes(blob[offset + 46 : offset + 46 + name_length]) == b"LICENSE.txt":
                struct.pack_into("<H", blob, offset + 10, 9)
            offset += 4
        self.archive.write_bytes(bytes(blob))
        with self.assertRaisesRegex(ArchiveError, "unsupported compression method"):
            validate_bom(self.bom(), self.root)

    def test_rejects_hash_and_size_mismatch(self):
        self.make_zip()
        bom = self.bom()
        bom["runtimes"][0]["archive"]["sha256"] = "0" * 64
        with self.assertRaisesRegex(ArchiveError, "SHA-256"):
            validate_bom(bom, self.root)

    def test_rejects_missing_licence(self):
        self.make_zip({"bin/runtime.exe": fake_pe_x64()})
        bom = self.bom()
        bom["runtimes"][0]["archive"]["files"] = ["bin/runtime.exe"]
        with self.assertRaisesRegex(ArchiveError, "licence"):
            validate_bom(bom, self.root)

    def test_rejects_wrong_architecture(self):
        self.make_zip({"bin/runtime.exe": b"not-pe", "LICENSE.txt": b"MIT"})
        with self.assertRaisesRegex(ArchiveError, "PE"):
            validate_bom(self.bom(), self.root)

    def test_rejects_mutable_tag_and_local_archive_escape(self):
        self.make_zip()
        bom = self.bom()
        bom["release_tag"] = "latest"
        with self.assertRaisesRegex(ArchiveError, "versioned"):
            validate_bom(bom, self.root)
        bom = self.bom()
        bom["runtimes"][0]["archive"]["name"] = "..\\runtime.zip"
        bom["runtimes"][0]["archive"]["url"] = "https://github.com/makekosmos/engine-addons/releases/download/runtime-v1.0.0/..%5Cruntime.zip"
        with self.assertRaises(ArchiveError):
            validate_bom(bom, self.root)

    def test_rejects_special_device_member(self):
        info = zipfile.ZipInfo("device")
        info.create_system = 3
        info.external_attr = 0o020666 << 16
        with zipfile.ZipFile(self.archive, "w") as stream:
            stream.writestr(info, b"device")
            stream.writestr("bin/runtime.exe", fake_pe_x64())
            stream.writestr("LICENSE.txt", b"MIT")
        bom = self.bom()
        bom["runtimes"][0]["archive"]["files"].append("device")
        with self.assertRaisesRegex(ArchiveError, "special device"):
            validate_bom(bom, self.root)

    def test_rejects_duplicate_ids_and_schema_drift(self):
        self.make_zip()
        bom = self.bom()
        duplicate = json.loads(json.dumps(bom["runtimes"][0]))
        duplicate["version"] = "1.0.1"
        bom["runtimes"].append(duplicate)
        with self.assertRaisesRegex(ArchiveError, "duplicate runtime ID"):
            validate_bom(bom, self.root)
        bom = self.bom()
        bom["runtimes"][0]["unexpected"] = True
        with self.assertRaisesRegex(ArchiveError, "schema mismatch"):
            validate_bom(bom, self.root)

    def test_rejects_target_and_entrypoint_type_confusion(self):
        self.make_zip()
        bom = self.bom()
        bom["runtimes"][0]["architecture"] = "arm64"
        with self.assertRaisesRegex(ArchiveError, "platform/architecture"):
            validate_bom(bom, self.root)
        bom = self.bom()
        bom["runtimes"][0]["entrypoints"] = [123]
        with self.assertRaisesRegex(ArchiveError, "entrypoints"):
            validate_bom(bom, self.root)

    def test_rejects_forged_central_directory_sizes(self):
        payload = os.urandom(8 * 1024 * 1024)
        self.make_zip({"bin/runtime.exe": fake_pe_x64(), "LICENSE.txt": b"MIT", "pad.bin": payload})
        blob = bytearray(self.archive.read_bytes())
        offset = blob.find(b"PK\x01\x02")
        while offset != -1:
            name_length = struct.unpack_from("<H", blob, offset + 28)[0]
            if bytes(blob[offset + 46 : offset + 46 + name_length]) == b"pad.bin":
                struct.pack_into("<I", blob, offset + 24, 4)  # forged uncompressed size
                struct.pack_into("<I", blob, offset + 16, zlib.crc32(payload[:4]))  # CRC matching the truncated prefix
                break
            offset = blob.find(b"PK\x01\x02", offset + 1)
        else:
            self.fail("pad.bin central record not found")
        self.archive.write_bytes(bytes(blob))
        bom = self.bom()
        bom["runtimes"][0]["archive"]["files"].append("pad.bin")
        with self.assertRaisesRegex(ArchiveError, "does not match the central directory"):
            validate_bom(bom, self.root)

    def test_rejects_noncanonical_timestamp_and_non_list_runtimes(self):
        self.make_zip()
        bom = self.bom()
        bom["generated_at"] = "2026-8-3T0:0:0Z"
        with self.assertRaisesRegex(ArchiveError, "canonical UTC"):
            validate_bom(bom, self.root, now=datetime(2026, 8, 30, 0, 1, tzinfo=timezone.utc))
        bom = self.bom()
        bom["runtimes"] = None
        with self.assertRaisesRegex(ArchiveError, "list"):
            validate_bom(bom, self.root)

    def test_archive_parsing_reuses_the_hashed_descriptor(self):
        self.make_zip()
        calls = []
        real = zipfile.ZipFile
        def spy(file, *args, **kwargs):
            calls.append(file)
            return real(file, *args, **kwargs)
        with unittest.mock.patch.object(zipfile, "ZipFile", side_effect=spy):
            results = validate_bom(self.bom(), self.root, now=datetime(2026, 8, 30, 0, 1, tzinfo=timezone.utc))
        self.assertEqual(len(calls), 1)
        self.assertFalse(isinstance(calls[0], (str, bytes, Path)))
        self.assertTrue(hasattr(calls[0], "fileno"))
        self.assertEqual(results[0]["files"], 2)

    def test_rejects_corrupt_deflate_member(self):
        self.make_zip()
        blob = bytearray(self.archive.read_bytes())
        name_offset = blob.find(b"LICENSE.txt")
        self.assertNotEqual(name_offset, -1)
        blob[name_offset + len(b"LICENSE.txt") : name_offset + len(b"LICENSE.txt") + 6] = b"\xff" * 6
        self.archive.write_bytes(bytes(blob))
        with self.assertRaises(ArchiveError):
            validate_bom(self.bom(), self.root)

    def test_rejects_boolean_sequence_non_string_build_and_non_zip_name(self):
        self.make_zip()
        bom = self.bom()
        bom["sequence"] = True
        with self.assertRaisesRegex(ArchiveError, "schema or sequence"):
            validate_bom(bom, self.root)
        bom = self.bom()
        bom["runtimes"][0]["build"]["recipe"] = {"command": "build"}
        with self.assertRaisesRegex(ArchiveError, "build provenance"):
            validate_bom(bom, self.root)
        bom = self.bom()
        bom["runtimes"][0]["archive"]["name"] = "runtime.bin"
        bom["runtimes"][0]["archive"]["url"] = "https://github.com/makekosmos/engine-addons/releases/download/runtime-v1.0.0/runtime.bin"
        with self.assertRaisesRegex(ArchiveError, "zip basename"):
            validate_bom(bom, self.root)


if __name__ == "__main__":
    unittest.main()
