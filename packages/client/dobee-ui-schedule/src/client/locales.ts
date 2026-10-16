/** Copy for guided automation creation, including the unsent conversation draft. */
export const en = {
  action: 'Create through chat',
  title: 'Create an automation task',
  description: 'Describe what to do and when. Next, review and send the request in a conversation so the assistant can create the task.',
  instruction: 'What should the task do?',
  instructionPlaceholder: 'For example: remind me to organize my daily report',
  timing: 'When should it run?',
  timingPlaceholder: 'For example: every weekday at 9:00 AM',
  timingHint: 'Include a date or repeat schedule and a time zone if needed.',
  next: 'Continue to conversation',
  cancel: 'Cancel',
  close: 'Close creation guide',
  confirmation: 'This step only prepares a draft; it does not send a message or create a task. After you send it, the assistant may ask for details. A task card confirms creation.',
  management: 'Once created, return to Automation tasks to view, edit, or delete the task.',
  emptyHint: 'Start with what to do and when, then send the request in a conversation. Created tasks appear here.',
  draft: 'Please create an automation task for me.\nTask: {instruction}\nSchedule: {timing}',
}

/** Chinese copy with the same required fields and creation semantics. */
export const zh: Record<keyof typeof en, string> = {
  action: '通过对话创建',
  title: '创建自动化任务',
  description: '先填写要做什么、什么时候执行，再到会话中确认并发送，由助手创建任务',
  instruction: '要做什么',
  instructionPlaceholder: '例如：提醒我整理日报',
  timing: '什么时候执行',
  timingPlaceholder: '例如：每个工作日上午 9 点',
  timingHint: '可填写具体日期或重复频率，需要时请注明时区',
  next: '前往会话确认',
  cancel: '取消',
  close: '关闭创建引导',
  confirmation: '这一步只准备草稿，不会发送消息，也不会创建任务。发送后，助手可能会向你确认细节；看到任务卡片才表示创建成功',
  management: '创建后，可回到“自动化任务”查看、修改或删除任务',
  emptyHint: '先描述任务内容和执行时间，再到会话中发送。创建成功的任务会显示在这里',
  draft: '请帮我创建一个自动化任务。\n任务内容：{instruction}\n执行时间：{timing}',
}
