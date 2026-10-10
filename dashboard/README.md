# 本地投研工作台

运行 `uv pip install --python .venv/bin/python -e '.[web]'` 安装网页依赖。
macOS 双击项目根目录的 `start-ui.command`，在浏览器访问 http://127.0.0.1:8765 。
启动器安装当前用户的 `local.tradingagents.dashboard` LaunchAgent，登录时启动，只监听本机地址。
也可以在项目目录直接运行 `.venv/bin/python -m dashboard.server`，不安装后台服务。不要同时启动两份服务。

## 使用

1. 在「模型与偏好」填写 DeepSeek Key，或沿用项目 `.env`。密钥不会返回到浏览器。
2. 添加自选股；在「我的持仓」保存并启用账户信息。持仓仅在下一次提交任务时生效。
3. 点击关注列表中每只股票旁的「分析」，右侧直接显示研究进度与结果。点击标的可切换结果，报告支持章节切换和历史记录。也可点击「分析全部关注」。任务按顺序执行，同一股票不重复排队。取消后立即从研究动态移除。
4. 「自动运行」可以设置每天某时刻，或每隔 15–1440 分钟分析；时间统一为 Asia/Shanghai。
5. 允许浏览器通知，保持页面打开即可收到新消息；页面关闭时，消息仍保存在本机，重新打开后在消息中心查看。

定时任务默认关闭，需添加股票和配置密钥后开启。开启后会按计划消耗模型额度。
周一至周五开关仅筛选星期，不代表交易所日历，也不限制盘中时段。
机器休眠、关机或服务关闭时不能运行；恢复后只补一个批次，跳过积压时段。
任务超过 45 分钟停止。服务重启将正在执行的任务标记为中断，用户可手动重跑，框架尽可能从检查点恢复。

## 记忆与存储

- 使用原项目 `memory_log_path`，默认 `~/.tradingagents/memory/trading_memory.md`。
- 原框架在后续分析时复盘到期决策，默认观察 5 个交易日。相同标的和日期仅保存一条记忆；工作台任务历史保留每次运行。
- 复盘比较的是标的后续收益及相对基准表现，不是账户实际盈亏；不会修改模型参数，也不更新真实持仓。
- 工作台设置、任务快照和站内消息：`~/.tradingagents/dashboard/dashboard.db`。
- 每次任务的报告与诊断记录：`~/.tradingagents/dashboard/runs/<id>/`。
- 当前持仓表适用于一个报价币种，未实现汇率换算、券商同步或实盘交易。

## 停止与卸载后台服务

在项目目录运行 `.venv/bin/python -m dashboard.service stop` 停止，运行启动器可重新启动。
运行 `.venv/bin/python -m dashboard.service uninstall` 停止并取消登录自启，保留数据。

## 验证

前端使用 Vite + React，源码位于 `frontend/`，构建文件由本地 Python 服务提供，无需同时运行 Node 服务。

首次安装或修改前端后：在 `frontend/` 运行 `npm ci`、`npm run build`。输出写入 `dashboard/static/`。

开发时先启动 Python 服务，再在 `frontend/` 运行 `npm run dev`，访问 http://127.0.0.1:5173/static/ 。开发服务器将 `/api` 代理至本地后端。

前端交互测试：在 `frontend/` 运行 `npm test`。

后端测试：在项目根目录运行 `.venv/bin/python -m pytest -q tests/test_dashboard.py`（先构建前端）。

测试使用临时数据库和模拟分析结果，不调用付费模型。真实模型分析需要有效 Key 和网络连接。
