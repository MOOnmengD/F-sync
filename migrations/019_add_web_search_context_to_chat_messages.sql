alter table public.chat_messages
add column if not exists web_search_context jsonb;

comment on column public.chat_messages.web_search_context is
'该轮 assistant 回复使用的轻量网页检索查询、检索结论与来源；不保存网页原文，随消息进入/退出聊天上下文。';
