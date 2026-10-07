/* ============================================================
多设备同步：整个仓库文件夹是一个 git 仓库，GitHub / Gitee 上的私有仓库当云端
（技术方案 §5.9）。git 引擎是编译进来的 libgit2，用户不用装 git。

- repo.rs       git 操作本身：提交、拉取合并、推送、打包。不碰 Vault，不依赖 tauri
- engine.rs     同步线程：什么时候同步、一轮怎么跑、锁怎么拿、状态和提示
- provider.rs   GitHub / Gitee 的接口：设备码登录、令牌续期、列出 / 新建仓库
- account.rs    账号：登录、拿一个能用的令牌（快过期就续）、退出
- secret.rs     令牌放系统钥匙串
- proxy.rs      找代理：应用里填的 > 环境变量 > 系统代理
- setup.rs      开启 / 断开同步：第一台设备接上云端、第二台 clone 到新文件夹、网盘检测
- history.rs    单篇文档的历史版本：每次改过它的提交，改名、挪位置靠属性块里的 id 跟着走
============================================================ */

pub mod account;
pub mod engine;
pub mod history;
pub mod provider;
pub mod proxy;
pub mod repo;
pub mod secret;
pub mod setup;

#[cfg(test)]
mod tests;
