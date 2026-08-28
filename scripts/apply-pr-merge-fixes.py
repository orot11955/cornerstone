from pathlib import Path
import json


def replace_once(path: str, old: str, new: str) -> None:
    file = Path(path)
    source = file.read_text()
    if old not in source:
        raise SystemExit(f"expected source was not found in {path}: {old[:160]!r}")
    file.write_text(source.replace(old, new, 1))


def replace_all(path: str, old: str, new: str, minimum: int = 1) -> None:
    file = Path(path)
    source = file.read_text()
    count = source.count(old)
    if count < minimum:
        raise SystemExit(
            f"expected at least {minimum} replacements in {path}, found {count}: {old!r}"
        )
    file.write_text(source.replace(old, new))


Path(".gitattributes").write_text("* text=auto eol=lf\n")

web_package = Path("apps/web/package.json")
web_manifest = json.loads(web_package.read_text())
web_manifest["scripts"]["test:e2e"] = (
    'pnpm --filter "web^..." build && playwright test'
)
web_manifest["scripts"]["test:e2e:auth"] = (
    'pnpm --filter "web^..." build && playwright test --config playwright.auth.config.ts'
)
web_package.write_text(json.dumps(web_manifest, indent=2) + "\n")

standard_path = Path("templates/canonical/standard.json")
standard = json.loads(standard_path.read_text())
base = next(fragment for fragment in standard["fragments"] if fragment["id"] == "base")
if not any(mapping.get("source") == ".gitattributes" for mapping in base["mappings"]):
    editor_index = next(
        index
        for index, mapping in enumerate(base["mappings"])
        if mapping.get("source") == ".editorconfig"
    )
    base["mappings"].insert(editor_index + 1, {"source": ".gitattributes"})
app_module = next(composer for composer in standard["composers"] if composer["id"] == "api-app-module")
for entry in app_module["nestModule"]["imports"]:
    if entry.get("names") == ["HealthModule"] and entry.get("from") == "./health/health.module.js":
        entry["names"] = ["GracefulShutdownModule"]
        entry["from"] = "./health/graceful-shutdown.module.js"
for entry in app_module["nestModule"]["moduleImports"]:
    if entry == {"kind": "identifier", "name": "HealthModule"}:
        entry["name"] = "GracefulShutdownModule"
standard_path.write_text(json.dumps(standard, indent=2) + "\n")

update_engine = "packages/create-cornerstone/src/mutation/update-engine.ts"
replace_once(
    update_engine,
    "export const generatedFileMode = 0o644\nconst updateLockRelativePath",
    "export const generatedFileMode = 0o644\n\nexport function fileModeMatches(mode: number, expected: number): boolean {\n  return process.platform === 'win32' || (mode & 0o777) === expected\n}\n\nfunction portableGeneratedFileMode(mode: number): number {\n  return process.platform === 'win32' ? generatedFileMode : mode & 0o777\n}\n\nconst updateLockRelativePath",
)
replace_once(
    update_engine,
    "(ownerInfo.mode & 0o777) !== 0o600",
    "!fileModeMatches(ownerInfo.mode, 0o600)",
)
replace_once(
    update_engine,
    "if ((projectLockInfo.mode & 0o777) !== generatedFileMode) {",
    "if (!fileModeMatches(projectLockInfo.mode, generatedFileMode)) {",
)
replace_once(
    update_engine,
    "beforeMode: projectLockInfo.mode & 0o777,",
    "beforeMode: portableGeneratedFileMode(projectLockInfo.mode),",
)
replace_once(
    update_engine,
    "(info.mode & 0o777) !== change.beforeMode",
    "!fileModeMatches(info.mode, change.beforeMode)",
)
replace_once(
    update_engine,
    "(info.mode & 0o777) !== entry.beforeMode",
    "!fileModeMatches(info.mode, entry.beforeMode)",
)
replace_once(
    update_engine,
    "mode: currentInfo.mode & 0o777,",
    "mode: portableGeneratedFileMode(currentInfo.mode),",
)
replace_all(
    update_engine,
    "mode: info.mode & 0o777,",
    "mode: portableGeneratedFileMode(info.mode),",
)
replace_once(
    update_engine,
    "(info.mode & 0o777) !== output.mode",
    "!fileModeMatches(info.mode, output.mode)",
)
replace_once(
    update_engine,
    "  return expected.some(({ checksum, mode }) => actual.checksum === checksum && actual.mode === mode)",
    "  return expected.some(\n    ({ checksum, mode }) =>\n      actual.checksum === checksum && (process.platform === 'win32' || actual.mode === mode),\n  )",
)

generator_engine = "packages/create-cornerstone/src/mutation/generator-engine.ts"
replace_once(
    generator_engine,
    "  ensureBackupParents,\n  generatedFileMode,\n  hasExactKeys,",
    "  ensureBackupParents,\n  fileModeMatches,\n  generatedFileMode,\n  hasExactKeys,",
)
replace_once(
    generator_engine,
    "    (info.mode & 0o777) === mode &&",
    "    fileModeMatches(info.mode, mode) &&",
)

schema_test = "packages/create-cornerstone/test/schema.test.mjs"
replace_once(
    schema_test,
    "const digest = `sha256:${'a'.repeat(64)}`",
    "const digest = `sha256:${'a'.repeat(64)}`\nconst pnpmExecutable = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'",
)
replace_all(
    schema_test,
    "spawnSync(\n    'pnpm',",
    "spawnSync(\n    pnpmExecutable,",
)
replace_once(
    schema_test,
    "  assert.equal(generatedWebPackage.scripts['test:e2e'], 'playwright test')",
    "  assert.equal(\n    generatedWebPackage.scripts['test:e2e'],\n    'pnpm --filter \\\"web^...\\\" build && playwright test',\n  )",
)
replace_once(
    schema_test,
    "    'playwright test --config playwright.auth.config.ts',",
    "    'pnpm --filter \\\"web^...\\\" build && playwright test --config playwright.auth.config.ts',",
)
replace_once(
    schema_test,
    "test('rejects chmod drift in an exact v2 predecessor before v3 adoption', async () => {\n  const fixture",
    "test('rejects chmod drift in an exact v2 predecessor before v3 adoption', async () => {\n  if (process.platform === 'win32') return\n  const fixture",
)
replace_once(
    schema_test,
    "  const modeTarget = join(fixture, 'mode-project')\n  await createProjectFromManifest(modeTarget, {\n    schemaVersion: 1,\n    name: 'mode-app',\n    profile: 'standard',\n  })\n  await chmod(join(modeTarget, 'README.md'), 0o600)\n  await assert.rejects(verifyProject(modeTarget), /mode drift.*README\\.md/i)",
    "  if (process.platform !== 'win32') {\n    const modeTarget = join(fixture, 'mode-project')\n    await createProjectFromManifest(modeTarget, {\n      schemaVersion: 1,\n      name: 'mode-app',\n      profile: 'standard',\n    })\n    await chmod(join(modeTarget, 'README.md'), 0o600)\n    await assert.rejects(verifyProject(modeTarget), /mode drift.*README\\.md/i)\n  }",
)
replace_once(
    schema_test,
    "  await chmod(join(target, 'README.md'), 0o600)\n  await assert.rejects(verifyProject(target), /generator-owned output drift.*README\\.md/i)\n})\n\ntest('rejects malformed immutable predecessor adoption source contracts'",
    "  if (process.platform !== 'win32') {\n    await chmod(join(target, 'README.md'), 0o600)\n    await assert.rejects(verifyProject(target), /generator-owned output drift.*README\\.md/i)\n  }\n})\n\ntest('rejects malformed immutable predecessor adoption source contracts'",
)
replace_once(
    schema_test,
    "test('rejects chmod-only drift during rollback instead of overwriting it', async () => {\n  const fixture",
    "test('rejects chmod-only drift during rollback instead of overwriting it', async () => {\n  if (process.platform === 'win32') return\n  const fixture",
)

Path(__file__).unlink()
