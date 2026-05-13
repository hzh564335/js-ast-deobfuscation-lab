# js-ast-deobfuscation-lab

> 基于 Babel AST 的 JavaScript 反混淆学习项目 —— 字符串数组还原、控制流恢复、内联解码等通用技术的工程化演练。

## 项目背景

本仓库是个人在学习 Web 业务风控与反爬虫前端对抗过程中,沉淀的一套通用 JavaScript 反混淆工具与样例。仓库内容**完全脱敏**:不针对任何具体生产环境,所有混淆样本均为自造合成,用于演示和复现常见混淆模式与还原思路。

主要目的有三:

1. 把"抓包分析 → 参数定位 → 调用栈回溯 → AST 解混淆 → Node 补环境 → 本地验证"流程中的 **AST 解混淆** 环节,以可运行的代码沉淀下来。
2. 拆解 5 类典型 JavaScript 混淆模式 —— 字符串数组、switch 控制流扁平化、字符串拼接、噪声变量、内联解码 —— 给每个模式一个独立可读的 visitor。
3. 给同样在学习 JS 逆向的同学一个可参照的工程化样板:目录结构、Babel API 用法、测试样本的组织方式。

## 简明流程

```
encode.js (合成混淆样本)
   +
descrypt.js (字符串数组模块)
        │
        ▼
┌──────────────────────────────┐
│ src/deobfuscate.js           │
│   visitor1  字符串数组还原    │
│   visitor2  控制流恢复        │
│   visitor3  join 字面量合并   │
│   visitor4  无引用变量清理    │
│   visitor5  内联解码函数      │
└──────────────────────────────┘
        │
        ▼
decode.js (可读源码)
```

## 目录结构

```
js-ast-deobfuscation-lab/
├── README.md                       # 本文件
├── LICENSE                         # MIT
├── package.json                    # Node 依赖声明
├── .gitignore
├── src/
│   └── deobfuscate.js              # 反混淆主脚本(5 个 visitor)
├── examples/
│   ├── obfuscated/
│   │   ├── encode.js               # 合成混淆样本(演示 5 类模式)
│   │   └── descrypt.js             # 合成字符串数组模块
│   └── deobfuscated/
│       └── decode.js               # 预期反混淆结果(对照参考)
└── docs/
    └── visitors.md                 # 每个 visitor 的设计文档
```

## 快速开始

环境要求:Node.js ≥ 16。

```bash
git clone https://github.com/hzh564335/js-ast-deobfuscation-lab.git
cd js-ast-deobfuscation-lab
npm install
npm run demo
```

运行后会在 `examples/deobfuscated/decode.js` 生成反混淆结果。可对照 repo 中已有的同名预期输出验证。

自定义输入:

```bash
node src/deobfuscate.js <input.js> <output.js> <string-array-module.js>
```

## 5 类混淆模式速览

| Pattern | 混淆形态 | 还原后 |
|---------|----------|--------|
| 1. 字符串数组 | `n[0]` `e[3]` `r[2]` | 原始字面量 |
| 2. 控制流扁平化 | `for(...orderArray...) switch(...)` | 顺序 BlockStatement |
| 3. join 拼接 | `['c','a','l','c'].join('')` | `'calc'` |
| 4. 噪声变量 | `var _decoy = "xxx"`(无引用) | 整行删除 |
| 5. 内联解码 | `decode("65,78,70")` | `"exp"` 并删除解码函数 |

详细的匹配条件、实现要点、局限性,见 [`docs/visitors.md`](docs/visitors.md)。

## 设计取舍

- **visitor 之间相互独立**:每个 visitor 处理一类混淆,职责单一。要新增模式或暂时关掉某个,改一行 `traverse(ast, visitorN)` 即可。
- **中途刷新作用域**:在 visitor1/2/3 跑完后 `generator -> parse` 一遍,再跑 visitor4/5。原因是 Babel 的 binding 信息不会随 `replaceWith` 自动同步,需要 print+reparse 强制刷新。
- **沙箱执行解码函数**:visitor5 用 `new Function` 而不是 AST 静态解释,代码更短但只适合学习场景;生产建议换成 `vm.runInNewContext` 或纯 AST 执行器。
- **不做变量重命名**:还原后变量名仍带混淆痕迹(`_h2s`、`r`、`e`、`n` 等)。这是有意保留的"原貌",方便对照混淆前后的结构;真正的可读化交给后续工序。

## 学习路线建议

如果你刚开始接触 JavaScript AST 逆向,推荐顺序:

1. 把本 repo clone 下来,`npm run demo` 跑通,对照 encode.js / decode.js 看每个模式的前后差异。
2. 通读 `src/deobfuscate.js`,搭配 `docs/visitors.md` 弄清每个 visitor 的匹配条件。
3. 找一些公开的轻度混淆 demo (例如 obfuscator.io 默认参数产出物) 喂给本工具,看哪些能处理、哪些失败,补 visitor。
4. 进阶:读一遍 [@babel/traverse 文档](https://babeljs.io/docs/babel-traverse) 和 [Babel handbook](https://github.com/jamiebuilds/babel-handbook),理解 Path / Scope / Binding 的设计。

## 局限与已知问题

- visitor2 的控制流扁平化只识别**单层、case consequent 首句即目标语句**的简单形式;嵌套或带 dispatcher 状态机的需要扩展。
- visitor5 在多次调用同一解码函数的场景下,函数定义不会被自动删除(因为 binding.referencePaths 不随 replaceWith 更新)。可在最后再扫一遍 FunctionDeclaration 统一清理。
- 不处理 ES Module 静态 import、动态 `import()`、Worker 等场景。
- 不处理 WebAssembly / asm.js 风格混淆。

欢迎以 PR 形式补 visitor 或扩展测试样本。

## 责任与使用声明

本项目仅用于学习 JavaScript AST 操作与反混淆技术,所有混淆样本均为自造合成,不针对任何具体生产环境或商业产品。请勿用于绕过任何在用的安全机制、爬取受保护的数据,或任何违反目标站点条款与所在地法律法规的用途。使用者自行承担一切后果。

## 许可

[MIT](LICENSE)
