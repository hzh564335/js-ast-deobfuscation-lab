/**
 * 反混淆预期输出 (expected output)
 * ============================================================
 * 本文件展示对同目录 ../obfuscated/encode.js 应用 5 个 visitor 处理后
 * 应得到的代码形态,供对照学习。实际跑 `npm run demo` 时,Babel
 * generator 输出的格式可能在空白/分号上略有差异,但语义等价。
 *
 * 跟踪:
 *   visitor1: 字符串数组替换
 *     n[0]/n[1]/n[2]/n[3] -> 'add'/'sub'/'multiply'/'unknown op'
 *     e[0]/e[1]/e[4]      -> 'exports'/'length'/'|'
 *     r[0]/r[1]/r[2]      -> 0/1/2
 *
 *   visitor2: switch 控制流扁平化
 *     for(var orderArray=[0,2,1], idx=0; idx<orderArray.length; idx++)
 *       switch(orderArray[idx]) { case 0:...; case 1:...; case 2:...; }
 *     -> 按 [0, 2, 1] 顺序展开成 BlockStatement
 *
 *   visitor3: ['calc','demo'].join('|') -> 'calc|demo'
 *
 *   visitor4: _decoy_alpha / _decoy_beta / _decoy_gamma 全部删除
 *
 *   visitor5: _h2s('64,6f,6e,65') -> 'done', 并删除 _h2s 函数定义
 */

const decrypt = require('./descrypt.js');
const { n, e, r } = decrypt;

function calc(op, x, y) {
    var tag = "calc|demo";
    var result;
    {
        result = x + y;
        result = result + 1;
        result = result * 2;
    }
    var label = "done";
    switch (op) {
        case "add":
            return result + tag + label;
        case "sub":
            return x - y;
        case "multiply":
            return x * y;
        default:
            return "unknown op";
    }
}

module["exports"] = { calc: calc };
