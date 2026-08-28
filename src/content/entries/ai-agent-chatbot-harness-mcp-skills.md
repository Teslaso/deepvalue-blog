---
title: AI Agent 到底是什么
publish_id: ai-agent-chatbot-harness-mcp-skills
domain: ai
format: article
status: published
published_at: 2026-08-26T09:56:25.341Z
updated_at: 2026-08-28T06:09:58.325Z
section: workflows
topic: ai-agents
summary: 从 Chatbot 与 Agent 的工作流差异出发，拆解 Agent Loop、Tool、Harness、MCP、Skills、Memory 与 Context，并说明为什么 Coding Agent 成为目前最成熟的 Agent 场景，以及 AI 应在个人研究流程中扮演什么角色。
thesis: Agent 的价值不只取决于模型能力，还取决于 Harness 如何组织工具、上下文、记忆、权限和反馈闭环；越数字化、可操作、可验证且可回滚的工作，越适合率先被 Agent 化。
confidence: medium
source_type: mixed
tags:
  - AI Agent
  - Chatbot
  - Harness
  - MCP
  - Skills
  - Agent Loop
  - 研究工作流
commodities: []
companies: []
tickers: []
---

# AI Agent 到底是什么

我最近想系统梳理一下自己对 AI 的看法。原因并不是单纯想了解几个新产品，而是我觉得 AI 已经开始成为工作中的一个长期变量。以后无论是和其他人交流讨论，还是自己判断新的 AI 产品，我至少应该形成一套比较稳定的理解，而不是只能说“ChatGPT 很好用”“Claude Code 很厉害”。

我最开始对目前 AI 工具的理解比较简单。

一类是最常见的 **Chatbot**，例如网页版的 ChatGPT、Claude 等，人通过对话提出问题，AI 回答，也可以搜索网页、生成图片、处理文件。

另一类则是现在越来越多的 **Agent**。其中我感觉目前最成熟的是 Coding Agent，另外各家厂商也正在快速推进办公 Agent、Research Agent 等。

但进一步想以后，我发现真正需要搞清楚的问题不是“现在有哪些 Agent 产品”，而是：

> **Agent 到底是什么？它和 Chatbot 的本质区别在哪里？Model、Tool、MCP、Skill、Memory、Context 和 Harness 又分别是什么？**

这轮研究最重要的结果，是把这些原本混在一起的概念逐渐分开。

## 1. 我最开始对 Chatbot 和 Agent 的理解

我最开始倾向于这样理解：

> Chatbot = 大模型 + 网页界面 + 一些工具  
> Agent = 大模型 + 更多工具 + 上下文管理 + 记忆 + 本地文件能力

这个理解不能说完全错误，因为今天的 Agent 确实通常拥有更复杂的工具、上下文和状态管理能力。

但进一步区分以后，我觉得真正关键的地方并不在这里。

首先，**网页、终端、IDE 都只是交互界面，并不能用来区分 Chatbot 和 Agent。**

一个网页里的 AI，如果能够自己拆解任务、调用工具、观察结果、继续执行，本质上完全可以具有很强的 Agent 能力。

反过来，一个运行在 Terminal 里的大模型，如果始终只是我问一句、它回答一句，也不一定就是 Agent。

其次，**工具多少也不是本质区别。**

一个 Chatbot 理论上完全可以挂几十个工具，而一个 Agent 可能只有浏览器、Terminal 和文件系统几个工具。

所以，现在我更倾向于用另一个问题判断：

> **到底是谁在控制任务的工作流？**

## 2. Chatbot 与 Agent 最重要的区别：谁在控制工作流

Anthropic 对 Agent 的一个定义对我很有启发：Agent 是能够在完成任务时**自主决定自己的过程以及工具使用方式**的 AI 系统，而不是按照预先固定的脚本执行。换句话说，模型会自己决定“下一步干什么”。

由此来看，Chatbot 和 Agent 可以做一个比较直观的区别。

### Chatbot：人在 orchestrate AI

比如我要研究一家公司。

传统的 Chatbot 使用方式可能是：

1. 我让 AI 搜一下公司业务；
    
2. AI 搜完以后回答我；
    
3. 我再让它查竞争对手；
    
4. 它查完以后再回答；
    
5. 我再让它整理行业数据；
    
6. 最后我再告诉它做成表格或者报告。
    

这里虽然 AI 也使用了很多工具，但是：

> **整个研究流程实际上仍然是我在管理。**

我负责判断下一步要干什么，AI 完成当前这一小步。

从这个意义上说：

> **我是项目经理，AI 更像一个随叫随到的顾问或助手。**

### Agent：AI 在 orchestrate tools

如果换成 Agent，我可能只提出一个最终目标：

> 研究这家公司某项业务的竞争力，并形成一份完整的投资研究框架。

之后 Agent 自己判断：

研究公司  
→ 找公司公告  
→ 搜索行业资料  
→ 找竞争对手  
→ 比较产品  
→ 发现信息缺口  
→ 再搜索  
→ 进行分析  
→ 整理证据  
→ 形成报告。

这时真正发生的变化是：

> **我不再逐步指挥 AI，而是给 AI 一个目标，由 AI 自己管理完成目标所需要的工作流。**

因此，目前我觉得这是理解 Agent 最有用的一句话：

> **Chatbot 时代，人在 orchestrate AI；Agent 时代，AI 开始 orchestrate tools。**

当然，这并不是一道绝对的分界线。现在很多 Chatbot 已经越来越 Agentic，而很多所谓 Agent 仍然需要大量人工确认，所以现实产品更像是一条从“被动回答”到“高度自主执行”的连续光谱。

## 3. Agent 最核心的机制：Agent Loop

如果把 Agent 的运行过程继续拆开，一个非常重要的概念就是 **Agent Loop**。

一个典型过程大致是：

```text
用户提出目标
↓
理解当前任务和上下文
↓
判断下一步需要做什么
↓
选择并调用工具
↓
观察工具返回的结果
↓
重新判断当前状态
↓
继续执行 / 修改方案 / 调用其他工具
↓
……
↓
任务完成、达到停止条件，或者需要向人确认
```

Anthropic 将这个过程概括为类似：

> plan → act → observe → adjust → repeat

也就是计划、行动、观察结果、调整，然后继续循环。

OpenClaw 自己的 Agent Runtime 文档里也明确存在 Agent Loop，并把一次运行描述为从消息输入开始，经过 Context Assembly、Model Inference、Tool Execution、Streaming 和 Persistence 等步骤形成完整闭环。

这让我意识到：

> **Agent 真正重要的不只是“会调用工具”，而是调用工具以后能够根据结果继续做判断。**

如果 AI 调一次搜索工具，然后直接把搜索结果返回给我，这和一个普通的工具增强型 Chatbot 差别没有那么大。

真正的 Agentic 行为在于：

> 行动 → 获得反馈 → 根据反馈调整 → 再行动。

## 4. Tool 决定 Agent 能做什么，但 Tool 不是 Agent 本身

我原来容易把“工具很多”和“Agent 很强”联系到一起。

现在觉得应该把两件事区分开。

**Tool 决定的是 Agent 可以对外界做什么。**

例如：

- Browser：访问网页；
    
- Search：检索信息；
    
- File System：读取和修改文件；
    
- Terminal：运行命令；
    
- Python：进行计算；
    
- Git：管理代码；
    
- Gmail：读取和发送邮件；
    
- Calendar：查看和修改日历；
    
- Database：查询数据库；
    
- CRM：读取客户信息。
    

这些实际上相当于 Agent 的“手和脚”。

但是即使一个 AI 有很多工具，如果还是必须由人不断告诉它：

> 先用这个工具，再用那个工具，然后干下一步。

它依然可能只是一种工具非常丰富的 Assistant。

所以我现在会把两件事分开理解：

> **Tools 决定 Agent 能做什么。**

而：

> **Agent Loop 和外部运行系统决定 Agent 能否自己持续把事情做完。**

## 5. 能不能访问本地文件，也不是 Agent 的本质区别

我之前还有一个直觉：Coding Agent 很像 Agent，是不是因为它可以直接处理本地文件？

进一步想以后，我觉得这个能力也不应该作为 Agent 的定义。

从系统角度来说：

> **文件系统本身也只是一种 Tool 或 Context Source。**

它和 Google Drive、数据库、Slack、网页等并没有本质区别。

真正关键的是 Agent 可以：

```text
读取文件
↓
理解代码
↓
修改代码
↓
运行程序
↓
发现报错
↓
分析报错
↓
重新修改
↓
运行测试
↓
继续迭代
```

所以 Agentic 的地方并不是：

> “它能读取本地文件。”

而是：

> **它可以围绕这些文件形成一个完整的行动—反馈—修正闭环。**

## 6. 为什么 Coding Agent 可能是目前最成熟的 Agent 场景

我最开始的一个判断是：目前各种 Agent 产品里，**Coding Agent 应该已经属于成熟度非常高、实际应用非常广泛的一类。**

更严谨一点说，与其直接判断 Coding Agent 已经“全面跨越鸿沟”，我现在更愿意表述为：

> **Coding Agent 是当前 Agent 产品中 PMF 最清晰、成熟度最高的一类。**

进一步研究以后，我觉得这不仅仅是因为程序员容易接受新工具，更重要的是：

> **软件开发本身就是一个天然 Agent-friendly 的环境。**

### 6.1 信息几乎全部数字化

程序员工作的主要对象本来就是：

- Code；
    
- Repository；
    
- Terminal；
    
- Documentation；
    
- Git；
    
- Database；
    
- API。
    

这些信息天然可以被模型读取。

相比之下，如果一个 Agent 要研究工厂经营情况，可能还需要实地观察设备、采访管理层、理解现场情况，这些都很难完全数字化。

### 6.2 AI 可以直接行动

Coding Agent 不只是回答：

> “这段代码应该怎么改？”

它还可以直接：

- 读取 Repository；
    
- 修改文件；
    
- 执行 Shell；
    
- 调用 Git；
    
- 安装 Dependency；
    
- 运行程序；
    
- 运行测试。
    

Claude Code 已经能够通过自己的项目上下文、工具、Memory、Subagents 等机制完成这类持续性任务。它的 `CLAUDE.md` 和 Auto Memory 还能够跨 Session 保存项目规则和过去形成的经验。

### 6.3 软件开发存在非常好的反馈机制

这是我觉得特别重要的一点。

Agent 写完代码以后可以运行：

```bash
npm test
```

或者：

```bash
pytest
```

系统可能明确告诉它：

```text
17 passed
2 failed
```

于是 Agent 马上知道：

> 当前方案还没有完成。

随后它继续读取错误、分析原因、修改代码、重新运行。

很多知识工作不存在这么明确的反馈。

比如一个 Agent 写了一份：

> 中国工程机械行业未来五年竞争格局研究报告。

系统并不会自动返回：

```text
Research Score: 82/100
```

研究报告到底好不好，很多时候仍然需要人的判断。

所以软件开发拥有一种非常宝贵的特征：

> **结果在很大程度上可以被机器验证。**

### 6.4 失败的成本相对可控，而且容易回滚

代码写错以后，可以：

- Git diff；
    
- Git revert；
    
- 删除 Branch；
    
- Restore file；
    
- 重新运行测试。
    

因此 Agent 可以不断尝试。

但如果 Agent 执行的是：

> 给供应商付款 500 万元。

显然不能允许它按照“试错—观察—再试”的方式工作。

所以我现在觉得，Coding Agent 最先成熟并不是一个偶然现象。

它背后的原因是：

> **软件开发同时满足高度数字化、机器可操作、机器可验证和错误可回滚几个重要条件。**

这可能也是判断未来哪些工作容易 Agent 化的一个重要框架。

## 7. 仅仅有 Model 和 Tools 还不够：Harness 是什么

研究到这里以后，我开始理解为什么最近 AI 行业越来越频繁讨论 **Harness**。

我最开始把 Agent 大致理解成：

> LLM + Tools。

现在我觉得这个公式太简单了。

更完整一点可以写成：

> **Agent ≈ Model + Tools + Context + Memory + Instructions/Skills + Agent Loop + State + Permissions/Guardrails**

而把这些东西真正组织起来运行的那套外部系统，大致就可以理解成 **Agent Harness**。

Harness 并不是一个像 TCP/IP 那样有绝对统一定义的技术标准，因此不同团队使用这个词时边界并不完全一样。

但用来理解 Agent 时，可以把它看作：

> **包裹在大模型外面，让模型能够持续、稳定、安全地完成复杂任务的一整套运行时和脚手架。**

## 8. 一个 Harness 通常需要管理哪些问题

当 Agent 真的开始执行一个几十分钟甚至更长的复杂任务时，会出现大量单纯依靠模型本身无法解决的问题。

### Context Management

例如：

- 当前应该给模型哪些信息？
    
- 哪些历史内容还重要？
    
- 哪些 Tool Result 可以删除？
    
- Context Window 满了怎么办？
    
- 什么时候应该 Compact？
    
- 什么内容应该 Retrieve？
    

OpenClaw 的 Context 系统就是一个很具体的例子。它会管理 Context Assembly、Compaction、Pruning 等问题，并区分长期 Session Transcript 和真正进入当前模型 Context 的内容。

### Memory

需要处理：

- 跨 Session 记住什么；
    
- 用户长期偏好；
    
- 项目规则；
    
- 过去任务中的经验；
    
- 哪些内容应该永久保存；
    
- 哪些只是当前 Session 状态。
    

### Tool Management

包括：

- 有哪些工具；
    
- 当前任务应该暴露哪些工具；
    
- 如何选择；
    
- Tool Schema 如何放入 Context；
    
- Tool 调用失败怎么办；
    
- 是否允许重试。
    

### Task State

一个长任务还需要知道：

- 已经完成到哪里；
    
- 哪些子任务完成；
    
- 哪些还没完成；
    
- 中断以后怎么 Resume；
    
- 是否需要 Checkpoint。
    

### Permissions 与 Guardrails

例如：

- 文件可以读但不能写；
    
- Git 可以 commit 但不能 push；
    
- 邮件可以生成 Draft，但发送前必须批准；
    
- 可以查银行余额，但不能转账；
    
- 某些 Shell Command 必须确认。
    

OpenAI 当前的 Workspace Agent 设计中也明确强调 Tools、Triggers、Guardrails、Approvals 和 Human-in-the-loop 等机制。

### Error Handling

Agent 还要知道：

- 工具调用报错以后怎么办；
    
- 应不应该 Retry；
    
- Retry 几次；
    
- 是换方案还是向用户提问；
    
- 什么情况下应该停止。
    

这些东西共同决定：

> **一个聪明的模型能不能变成一个真正可靠的 Agent。**

## 9. 我现在对 Model 和 Harness 关系的理解

这轮讨论以后，我觉得有一个判断很值得保存：

> **Model 决定 Agent 的智能上限，而 Harness 很大程度决定 Agent 能不能稳定接近这个上限。**

过去讨论 AI 产品，很容易把全部差异归因于：

> GPT 和 Claude 哪个模型更聪明？

但 Agent 时代以后，同样一个底层 Model，在不同产品里的实际体验可能差别非常大。

原因可能并不只是模型，而在于外面的：

- Context Engineering；
    
- Tool Design；
    
- Memory；
    
- Agent Loop；
    
- Permission；
    
- Skill；
    
- Error Recovery；
    
- Session Management；
    
- Prompt Assembly。
    

所以，我现在更倾向于把 Agent 产品能力理解成：

> **Model × Harness × Tools × Domain Knowledge**

而不是单纯比较模型 Benchmark。

## 10. Model、Tool、MCP、Skill、Memory、Harness 分别是什么

为了以后不再把这些词混到一起，我现在可以用一个比较简单的类比理解。

|概念|我现在的理解|
|---|---|
|**Model**|大脑，负责理解、推理和做决定|
|**Tools**|手脚，让模型能够对外部世界采取行动|
|**MCP**|工具和数据接入的一种标准接口|
|**Skills**|某类任务的工作方法和操作手册|
|**Context**|模型当前这一轮能够看到的信息|
|**Memory**|需要跨时间保存和重新调用的经验或信息|
|**Agent Loop**|思考—行动—观察—调整—继续的循环|
|**Harness**|把以上组件组织起来持续运行的执行系统|

这个类比不是严格的软件工程定义，但对我理解整个 Agent Stack 很有帮助。

## 11. MCP：解决“Agent 怎么接上外部世界”

我之前会把 MCP 和 Skill 混在一起，甚至隐约把它们理解成一代技术替代另一代技术。

现在看来不是这样。

**MCP（Model Context Protocol）主要解决的是标准化连接的问题。**

最新 MCP 规范仍然围绕模型如何连接外部系统展开，Server 可以暴露 Tools、Resources 和 Prompts 等能力，让支持 MCP 的 Host 使用这些外部资源。

例如一家企业有：

- CRM；
    
- 数据库；
    
- GitHub；
    
- 内部知识库；
    
- 财务系统。
    

过去每个 AI 产品都可能需要单独开发 Integration。

MCP 更像是在尝试提供一套统一接口。

所以可以粗略理解成：

> **MCP 回答的是：“Agent 能接入什么，以及应该怎么接。”**

例如一个金融数据 MCP Server 可以向 Agent 提供：

```text
get_company_financials()
get_stock_price()
search_company_filing()
```

Agent 看到这些工具以后，就可以根据任务选择调用。

## 12. Skill：解决“有了工具以后应该怎么做事”

Skill 所解决的问题完全不同。

如果 MCP 给一个 Agent 接上：

- 搜索工具；
    
- 财务数据库；
    
- Excel；
    
- Python；
    
- 公司公告数据库。
    

Agent仍然可能不知道：

> **到底怎样才算完成一次合格的上市公司研究？**

这时候就需要方法。

Agent Skills 的规范非常直观：一个 Skill 至少包含 `SKILL.md`，还可以配套 `scripts/`、`references/` 和 `assets/` 等资源。

例如可以设计一个：

```text
equity-due-diligence/
├── SKILL.md
├── scripts/
├── references/
└── assets/
```

其中告诉 Agent：

1. 先理解公司商业模式；
    
2. 再研究行业；
    
3. 分析竞争格局；
    
4. 分析财务数据；
    
5. 做管理层和治理分析；
    
6. 找核心变量；
    
7. 建立估值；
    
8. 检查风险；
    
9. 最终形成投资判断。
    

因此：

> **MCP 给 Agent 工具，Skill 给 Agent 方法论。**

它们不是替代关系，而是可以同时存在。

一个比较形象的类比是：

> MCP 像给一个员工接上 Bloomberg、Excel 和数据库；
> 
> Skill 则像把公司的研究 SOP 和资深分析师的方法交给这个员工。

## 13. Claude Code 应该怎样理解

我最开始会把 Claude Code 和 OpenClaw 放在一起比较，甚至隐约觉得：

> Claude Code 是一种 Coding Agent，OpenClaw 好像才更像 Harness。

进一步拆开以后，我觉得这个理解也需要修正。

**Claude Code 本身其实已经包含了一整套 Coding Agent Harness。**

它并不是单纯：

> Claude Model + Terminal。

它还涉及：

- Codebase Context；
    
- Tool Calling；
    
- File Editing；
    
- Terminal；
    
- Memory；
    
- `CLAUDE.md`；
    
- Permissions；
    
- Subagents；
    
- MCP；
    
- Skills；
    
- Session Context。
    

Claude Code 的官方文档显示，每次 Session 都会有新的 Context Window，而 `CLAUDE.md` 和 Auto Memory 可以把项目指令和过去积累的经验带到后续 Session；Subagents 则可以拥有独立 Context、独立 Tool 权限、Memory、Skills 和 MCP Servers。

所以更准确的理解应该是：

> **Claude Code = 面向软件开发场景高度垂直化的 Agent + Coding Harness + Coding Tools + Coding UX。**

至于它是不是“最早的 Coding Agent”，我目前没有必要下这么绝对的历史判断。对我来说更重要的是，它代表了 Coding Agent 已经发展到什么程度。

## 14. OpenClaw 和 Claude Code 的区别

OpenClaw 给我的感觉之所以更加“Harness 化”，主要是因为它的定位比单一 Coding Agent 更宽。

OpenClaw 官方文档把自己的 Runtime 描述为一整套集成环境，其中包括：

- model discovery；
    
- tool wiring；
    
- prompt assembly；
    
- session management；
    
- channel delivery；
    
- workspace；
    
- memory；
    
- skills。
    

每个 Agent 还有自己的 Workspace、Bootstrap Files 和 Session Store。

这意味着它不只是解决：

> “AI 怎么帮我写代码？”

而是在进一步解决：

> “一个长期存在的 Agent 应该怎样拥有自己的 Workspace、Memory、Tools、Skills、Sessions 和不同通信入口？”

因此，我现在更愿意把两者理解成两个层次不同的东西：

> **Claude Code 更像一个垂直在 Coding 领域的完整 Agent Runtime。**

而：

> **OpenClaw 更接近通用个人 Agent 的 Runtime / Control Plane / Orchestration Layer。**

二者并不一定是一组完全互斥的竞争产品。

## 15. Agent 应该怎样分类

我最开始想到 Agent 时，主要想到：

- Coding Agent；
    
- 办公 Agent。
    

这两个确实是目前非常重要的产品方向，但如果建立一套长期使用的认知框架，只按照产品场景分类还不够。

我现在觉得至少可以从三个维度理解 Agent。

### 15.1 按场景分类

例如：

- **Coding Agent**
    
- **Research Agent**
    
- **Office / Workspace Agent**
    
- **Customer Service Agent**
    
- **Sales Agent**
    
- **Finance Agent**
    
- **Legal Agent**
    
- **Browser / Computer-use Agent**
    
- **Personal Agent**
    

其中办公 Agent 值得特别关注。

OpenAI 目前对 Workspace Agent 的定位已经从一次性的“写一段文字、总结一份材料”，转向能够复用的工作流：连接企业系统、设置 Workflow、Trigger、Tools 和 Guardrails，让 AI 重复完成团队原本需要人工执行的多步骤知识工作。

### 15.2 按自主程度分类

可以粗略分成：

**Copilot**

> 人在工作，AI 辅助。

例如我写报告，AI帮我润色。

**Agent**

> 人给目标，AI负责一段相对完整的工作。

例如我要求它研究一个行业，并自己完成资料搜索、分析和输出。

**更高自主性的 Agent**

> 人给目标、规则和权限边界，Agent 可以持续运行，在需要的时候再找人。

实际上这更像一条连续光谱，而不是三个严格的产品类别。

### 15.3 按系统架构分类

还可以分为：

**Single Agent**

```text
User
  ↓
Agent
  ├── Search
  ├── Browser
  ├── Python
  ├── Database
  └── Files
```

**Multi-Agent**

```text
User
  ↓
Manager Agent
  ├── Research Agent
  ├── Coding Agent
  ├── Data Agent
  └── Writing Agent
```

Multi-Agent 的核心并不是单纯“多开几个模型”，而是不同 Agent 拥有不同 Context、Tools、Role 和任务边界，再由某种 Orchestrator 进行协调。

## 16. 这轮研究后，我对 Agent 的一个完整理解

如果现在重新回答：

> **Agent 到底是什么？**

我不会再简单说：

> Agent 就是大模型加很多工具。

我目前更倾向于这样理解：

> **Agent 是以大模型作为决策核心，通过 Agent Loop 持续观察状态、选择行动和调用工具，并由 Harness 管理 Context、Memory、State、Tools、Permissions 等运行环境，从而能够围绕一个目标自主完成多步骤任务的系统。**

这里面真正值得注意的不是某一个组件，而是这些组件之间的关系。

```text
                   ┌─────────────┐
                   │    Goal     │
                   └──────┬──────┘
                          ↓
                    ┌───────────┐
                    │   Model   │
                    └─────┬─────┘
                          │
          ┌───────────────┼───────────────┐
          ↓               ↓               ↓
       Context          Memory          Skills
          │               │               │
          └───────────────┼───────────────┘
                          ↓
                    Agent Loop
                          │
                          ↓
                       Tools
                          │
          ┌───────────────┼───────────────┐
          ↓               ↓               ↓
        Web            Files          Software
```

而外面还有一层：

```text
Harness
├── Context Management
├── Session Management
├── Memory
├── Tool Management
├── State
├── Permissions
├── Guardrails
├── Error Recovery
├── Compaction
└── Logging / Evaluation
```

这样以后再遇到一个新的所谓“Agent 产品”，我就不需要只看它叫什么，而可以直接问几个问题：

1. **底层 Model 是什么？**
    
2. **能访问哪些 Tools？**
    
3. **谁在控制 Workflow？**
    
4. **有没有真正的 Agent Loop？**
    
5. **Context 是怎么管理的？**
    
6. **有没有长期 Memory？**
    
7. **有没有 Skill 或类似的工作方法层？**
    
8. **权限和 Guardrails 怎么设计？**
    
9. **长任务失败以后能不能 Resume？**
    
10. **结果有没有 Feedback / Verification 机制？**
    

我觉得这套问题比单纯比较“哪个 Agent 更聪明”更有价值。

## 17. 如果别人问我怎么看 AI Agent

如果别人问我：

> 你怎么看现在的 AI Agent？

我现在至少已经可以形成一个相对稳定的回答逻辑。

首先，我觉得 AI 正在从以 Chatbot 为中心的产品形态，逐渐进入更加 Agentic 的阶段。

Chatbot 最主要解决的是**回答问题和辅助单个任务**；Agent 更重要的是**完成一段完整的工作**。

两者真正的区别不在于是不是网页、能不能读本地文件，甚至也不完全在于工具多少，而在于：

> **谁在控制工作流。**

过去很多时候，是人把工作拆成一个个步骤，然后不断告诉 AI 下一步做什么。

Agent 则是在给定目标以后，由模型自己判断下一步该干什么、使用什么工具、得到结果以后是否需要调整，然后持续执行。

因此我觉得 Agent 真正重要的不只是模型本身，还包括模型外面的 Harness，例如：

- Context；
    
- Memory；
    
- Tools；
    
- Skills；
    
- Permissions；
    
- Task State；
    
- Error Recovery。
    

同样一个模型放到不同的 Harness 里，最终能不能稳定完成复杂工作，差异可能很大。

从现在的应用来看，我比较关注 Coding Agent 和办公 Agent。

Coding Agent 已经表现出非常高的成熟度，我觉得一个重要原因不是“程序员更容易接受 AI”，而是软件开发环境天然适合 Agent：信息高度数字化，AI 可以直接行动，代码结果又能够通过 Compiler 和 Test 获得机器反馈，而且失败以后容易回滚。

办公 Agent 的潜在市场可能更大，但难度也更高，因为企业真实工作会涉及权限、数据、安全、部门流程，以及大量没有客观评分标准的知识工作。

所以现阶段我对 Agent 的关注点，已经逐渐从：

> “下一个更聪明的模型是什么？”

转向：

> **“怎样把足够聪明的模型，放进一个真正能够完成工作的系统里？”**

## 18. 目前形成的几个核心判断

这轮讨论以后，我觉得目前最值得长期保存的是下面几个判断。

### 判断一：Agent 的核心不是 Tools 多，而是 Workflow Control

> **真正重要的是模型能否自己决定下一步行动，并根据结果持续调整。**

### 判断二：Tool 和 Agent 要区分

> **Tools 决定 Agent 能干什么；Agent Loop 决定它能不能把这些能力组织起来完成任务。**

### 判断三：Harness 会越来越重要

> **Model 决定智能上限，Harness 很大程度决定 Agent 能否稳定接近这个上限。**

### 判断四：MCP 和 Skill 不是替代关系

> **MCP 解决怎么接工具和数据；Skill 解决接上以后应该按照什么方法做事。**

### 判断五：Coding Agent 的成熟并非偶然

> **一个工作环境越数字化、越容易被机器操作、结果越容易自动验证、错误越容易回滚，就越适合率先被 Agent 化。**

这条判断可能不仅能解释 Coding Agent，也可以作为以后观察其他行业 Agent 化进程的一个基本框架。

## 19. 后续还值得继续研究的问题

目前我对 Agent 的技术框架已经比最开始清楚很多，但还有一些问题值得继续研究。

### Agent 为什么可能比 Chatbot 更接近真正的产品范式变化？

如果过去的软件是：

> 人操作软件。

未来越来越多的软件可能变成：

> 人告诉 Agent 自己想实现什么，Agent 再操作软件。

如果这个变化成立，那么 Agent 的意义可能就不只是：

> “知识工作效率提高 20%。”

而可能涉及：

- SaaS 的产品形态；
    
- 企业软件的入口；
    
- 白领工作的分工方式；
    
- 企业组织结构；
    
- 人与软件的交互方式。
    

### 什么样的工作最容易 Agent 化？

Coding Agent 给出了一个很好的参照。

可以进一步研究几个变量：

- 数字化程度；
    
- 工具是否机器可调用；
    
- 结果能否自动验证；
    
- 错误是否可回滚；
    
- 行动风险高低；
    
- 是否涉及隐性知识；
    
- 是否大量依赖人与人沟通；
    
- 是否存在清晰 SOP。
    

这可能形成一个判断不同行业 Agent 落地速度的框架。

### 办公 Agent 最终会以什么方式进入企业？

现在还需要继续观察：

- 是嵌入现有 Office / SaaS；
    
- 还是出现独立 Agent 平台；
    
- 是一个通用 Agent；
    
- 还是大量垂直 Skill；
    
- 是 Single Agent；
    
- 还是企业内部 Multi-Agent Network。
    

### Model 和 Harness 的价值未来会怎样分配？

如果基础模型之间的能力差距逐渐缩小，那么未来 AI 应用的竞争壁垒可能越来越多来自：

- Proprietary Data；
    
- Context；
    
- Workflow；
    
- Skills；
    
- Tools；
    
- Memory；
    
- Integration；
    
- Evaluation；
    
- Trust / Permissions。
    

这也是我接下来理解 AI 产品和 AI 公司时值得重点观察的问题。

## 参考资料

- Anthropic 对 Agent 与 Workflow 的区分：Agent 的关键在于模型动态控制自己的过程和 Tool Usage。
    
- OpenAI Workspace Agents：重复工作流、Tools、Triggers、Guardrails 和 Human-in-the-loop。
    
- Model Context Protocol：MCP Server 暴露 Tools、Resources 等外部能力。
    
- Agent Skills Specification：以 `SKILL.md` 为核心，可包含 Scripts、References 和 Assets。
    
- Claude Code Memory 与 Subagents 文档：跨 Session Context、`CLAUDE.md`、Auto Memory、独立 Subagent Context 与 Tools。
    
- OpenClaw Agent Runtime、Agent Loop 与 Context 文档。
