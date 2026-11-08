// @dreamariner/dsh-chat-search :: 源码导入纪律护栏（依赖决策表的机械执行）
//
// 决策表（scripts/lib/manifest-deps.mjs）：peer = 外置（宿主供给同一实例）；
// dependencies = 内联自带；devDependencies = 只许 `import type`。
//
// 本护栏锁**源码**，与构建门（tsdown onlyImport）的分工要紧：
// 构建门扫**产物 chunk** 的裸 import，但 devDep 被值导入时会先被 alwaysBundle
// **内联进产物**（产物里不再有裸 import）→ 构建门看不见；内联 cordis 这类带
// 模块级注册表的包 = 运行期第二实例，作用域与注册表不跨副本共享，插件静默
// 失灵（早期插件仓的实测事故形态，2026-10-22：教训是「cordis 必须 peer + dev 双声明」，
// 这里把教训沉淀成机械检查：值导入必须先升级声明栏位）。
// `import type` 类型擦除、零值导入，不受本护栏约束。
import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import ts from 'typescript'

const ROOT = process.cwd()
const PKG = join(ROOT, '.')

// manifest-deps 两布局都在 <仓根>/scripts/lib/（single 的仓根即包根），根 vitest
// 的 cwd 恒为仓根；相对路径随布局变化写不出静态 import，按 URL 动态引入。
const { devDepsOf, depsOf, peersOf, readManifest, runtimeAllowed } = await import(
  pathToFileURL(join(ROOT, 'scripts', 'lib', 'manifest-deps.mjs')).href
)

const manifest = readManifest(PKG)
const PEERS = peersOf(manifest)
const DEPS = depsOf(manifest)
const DEV = devDepsOf(manifest)

// client 半边的模块表供给：react 系是宿主 baseline（与 tsdown/client.ts.tpl 的
// EXTERNALS 同源，改动须两处同步），非 baseline 请求在 manifest 的 dsh.client.external。
const CLIENT_BASELINE = ['react', 'react/jsx-runtime', 'react-dom', 'react-dom/client']
const CLIENT_EXTERNALS = [...CLIENT_BASELINE, ...(manifest.dsh?.client?.external ?? [])]

/** 收集 src/ 下全部 TS/TSX 源码，按目录判半边（src/client/ 下是 client，其余 host）。 */
function sourceFiles(dir: string, out: Array<{ file: string; half: 'host' | 'client' }> = []): Array<{ file: string; half: 'host' | 'client' }> {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry)
    if (statSync(p).isDirectory()) sourceFiles(p, out)
    else if (/\.tsx?$/.test(entry)) {
      const rel = relative(join(PKG, 'src'), p)
      out.push({ file: p, half: rel.split(sep)[0] === 'client' ? 'client' : 'host' })
    }
  }
  return out
}

interface Rec {
  file: string
  line: number
  spec: string
  typeOnly: boolean
  half: 'host' | 'client'
}

/** 一个 import/export 节点的「只绑定类型」判定：语法级，不信正则。
 *  ⚠ 旗标有两层：ExportDeclaration 顶层有 isTypeOnly；ImportDeclaration 没有，
 *  `import type` 的旗标在 importClause.isTypeOnly 上，两层都要查（只查元素级
 *  会漏掉 `import type { X }` 整句形态，只查子句级会漏掉 `{ type X }` 内联形态）。
 *  ⚠ 只用 ts.isNamedImports / ts.isNamedExports 守卫做窄化，不对联合类型直取
 *  属性或跨 kind 比较：AST d.ts 的联合形状随 TS 小版本变，守卫 API 稳。 */
function isTypeOnlyBinding(node: ts.ImportDeclaration | ts.ExportDeclaration): boolean {
  if (ts.isImportDeclaration(node)) {
    const clause = node.importClause
    if (!clause) return false
    if (clause.isTypeOnly) return true // `import type { X }` / `import type X` 整句形态
    if (clause.name) return false // 默认导入 = 值
    const named = clause.namedBindings !== undefined && ts.isNamedImports(clause.namedBindings) ? clause.namedBindings : undefined
    return named !== undefined && named.elements.length > 0 && named.elements.every((e) => e.isTypeOnly)
  }
  if (node.isTypeOnly) return true // `export type { X } from '…'` 顶层旗标
  const named = node.exportClause !== undefined && ts.isNamedExports(node.exportClause) ? node.exportClause : undefined
  return named !== undefined && named.elements.length > 0 && named.elements.every((e) => e.isTypeOnly)
}

function collectImports(files: Array<{ file: string; half: 'host' | 'client' }>): Rec[] {
  const recs: Rec[] = []
  for (const { file, half } of files) {
    const sf = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true,
      /\.tsx$/.test(file) ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
    const visit = (node: ts.Node): void => {
      let spec: string | undefined
      let typeOnly = false
      if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
        spec = node.moduleSpecifier.text
        typeOnly = isTypeOnlyBinding(node)
      } else if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
        spec = node.moduleSpecifier.text
        typeOnly = isTypeOnlyBinding(node)
      } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword
        && node.arguments.length === 1 && ts.isStringLiteral(node.arguments[0])) {
        spec = (node.arguments[0] as ts.StringLiteral).text // 动态 import 恒为值
      } else if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'require'
        && node.arguments.length === 1 && ts.isStringLiteral(node.arguments[0])) {
        spec = (node.arguments[0] as ts.StringLiteral).text
      } else if (ts.isImportEqualsDeclaration(node)
        && node.moduleReference.kind === ts.SyntaxKind.ExternalModuleReference) {
        const ref = node.moduleReference as ts.ExternalModuleReference
        if (ts.isStringLiteral(ref.expression)) spec = ref.expression.text // import x = require('…')
      }
      if (spec !== undefined) {
        recs.push({ file, line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1, spec, typeOnly, half })
      }
      ts.forEachChild(node, visit)
    }
    ts.forEachChild(sf, visit)
  }
  return recs
}

const SRC = join(PKG, 'src')
const files = existsIn(SRC) ? sourceFiles(SRC) : []
const recs = collectImports(files)

function existsIn(p: string): boolean {
  try { statSync(p); return true } catch { return false }
}

/** 本护栏只管「声明栏位纪律」：相对/绝对路径导入不涉及 package.json 栏位；
 *  node: 内建天然外置（host 合法；client 的 node: 禁令归 client-boundary.spec）。 */
function inScope(r: Rec): boolean {
  return !r.spec.startsWith('.') && !r.spec.startsWith('/') && !r.spec.startsWith('node:')
}

/** 包名提取：裸导入说明符常带子路径（pkg/sub、@scope/pkg/sub），按 scope 规则取包名段。 */
function pkgNameOf(spec: string): string {
  return spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0]
}

/** 自引用子路径（<自身包名>/…）：经 package.json self-reference 解析，是模板认可
 *  形态（client 半边产物还会把它内联，见 tsdown 配置「不要把本包子路径放进
 *  EXTERNALS」的注释）。 */
const SELF: string = manifest.name ?? ''
const isSelfRef = (r: Rec): boolean => r.spec === SELF || r.spec.startsWith(`${SELF}/`)

const allowedOf = (r: Rec): string[] => runtimeAllowed(manifest, r.half, CLIENT_EXTERNALS)
const isAllowed = (r: Rec): boolean => {
  const pkg = pkgNameOf(r.spec)
  return allowedOf(r).includes(r.spec) || allowedOf(r).includes(pkg)
}

describe('源码导入纪律（依赖决策表）', () => {
  it('扫到源码文件（防止目录挪走后护栏空转成绿）', () => {
    expect(files.length).toBeGreaterThan(0)
  })

  it('值导入都落在声明过的运行期白名单（host = peer ∪ deps；client 另加模块表供给）', () => {
    const offenders = recs
      .filter((r) => inScope(r) && !r.typeOnly && !isSelfRef(r) && !isAllowed(r))
      .map((r) => `${r.file}:${r.line} 值导入了 '${r.spec}'（${r.half} 半边）`
        + `\n    → 升进 peerDependencies（宿主供给同一实例）或 dependencies（内联自带），或改 import type`)
    expect(offenders, `源码出现声明外的值导入：\n${offenders.join('\n')}`).toEqual([])
  })

  it('devDependencies 只许 import type（值导入会被 alwaysBundle 内联，cordis 类包即第二实例）', () => {
    const offenders = recs
      // peer + dev 双声明（I1 形态）不算犯：dev 那份只服务 typecheck，运行期走宿主那份。
      // client 半边由模块表供给的包（react 系 baseline / dsh.client.external）也不算犯：
      // 构建走 neverBundle 外置、运行期宿主渲染进程供给（对应 tsdown client 的 EXTERNALS）。
      .filter((r) => inScope(r) && !r.typeOnly && DEV.includes(pkgNameOf(r.spec))
        && !PEERS.includes(pkgNameOf(r.spec)) && !DEPS.includes(pkgNameOf(r.spec))
        && !(r.half === 'client' && (CLIENT_EXTERNALS.includes(r.spec) || CLIENT_EXTERNALS.includes(pkgNameOf(r.spec)))))
      .map((r) => `${r.file}:${r.line} 值导入了 devDep '${r.spec}'`
        + `\n    → 先升 peer（宿主同实例）或 dependencies（内联），再保持值导入；或改回 import type`
        + `\n    （client 半边例外：若该包由模块表供给，请把它加进 package.json 的 dsh.client.external）`)
    expect(offenders, `devDependencies 被值导入：\n${offenders.join('\n')}`).toEqual([])
  })
})
