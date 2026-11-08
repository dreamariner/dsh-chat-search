// @dreamariner/dsh-chat-search :: 全局测试隔离护栏
//  1) DSH_HOME 指向本次运行的临时目录：插件里经 DSH_HOME 派生的路径（日志、store 等）
//     全部落在临时目录，测试既读不到真实配置、也不会写进真实运行时目录。
//  2) 用到密钥的插件在这里补一条：测试进程会继承生产环境变量，按需把密钥类变量清零
//     （各用例在 beforeEach 里显式设置自己需要的值）。

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll } from 'vitest'

let testHome: string

beforeAll(() => {
  testHome = mkdtempSync(join(tmpdir(), 'dsh-chat-search-test-home-'))
  process.env.DSH_HOME = testHome
})

afterAll(() => {
  rmSync(testHome, { recursive: true, force: true })
})
