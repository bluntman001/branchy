import { useState, useCallback, useRef } from 'react';
import Anthropic from '@anthropic-ai/sdk';
import type { MessageParam, Tool } from '@anthropic-ai/sdk/resources/messages';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  isStreaming?: boolean;
  isError?: boolean;
}

const FILE_TOOLS: Tool[] = [
  {
    name: 'list_directory',
    description: 'List files and folders in a directory',
    input_schema: {
      type: 'object',
      properties: { path: { type: 'string', description: 'Directory path to list' } },
      required: ['path'],
    },
  },
  {
    name: 'search_files',
    description: 'Recursively search for files by name',
    input_schema: {
      type: 'object',
      properties: {
        root_path: { type: 'string', description: 'Root directory to search from' },
        query: { type: 'string', description: 'Filename substring to search for' },
      },
      required: ['root_path', 'query'],
    },
  },
  {
    name: 'rename_file',
    description: 'Rename a file or folder',
    input_schema: {
      type: 'object',
      properties: {
        old_path: { type: 'string', description: 'Current file path' },
        new_path: { type: 'string', description: 'New file path' },
      },
      required: ['old_path', 'new_path'],
    },
  },
  {
    name: 'move_files',
    description: 'Move files to a destination directory',
    input_schema: {
      type: 'object',
      properties: {
        source_paths: { type: 'array', items: { type: 'string' }, description: 'Paths to move' },
        dest_dir: { type: 'string', description: 'Destination directory' },
      },
      required: ['source_paths', 'dest_dir'],
    },
  },
  {
    name: 'copy_files',
    description: 'Copy files to a destination directory',
    input_schema: {
      type: 'object',
      properties: {
        source_paths: { type: 'array', items: { type: 'string' }, description: 'Paths to copy' },
        dest_dir: { type: 'string', description: 'Destination directory' },
      },
      required: ['source_paths', 'dest_dir'],
    },
  },
  {
    name: 'delete_files',
    description: 'Delete files (moves to trash)',
    input_schema: {
      type: 'object',
      properties: {
        paths: { type: 'array', items: { type: 'string' }, description: 'Paths to delete' },
      },
      required: ['paths'],
    },
  },
  {
    name: 'create_folder',
    description: 'Create a new folder',
    input_schema: {
      type: 'object',
      properties: { path: { type: 'string', description: 'Folder path to create' } },
      required: ['path'],
    },
  },
  {
    name: 'open_file',
    description: 'Open a file with the default system application',
    input_schema: {
      type: 'object',
      properties: { path: { type: 'string', description: 'File path to open' } },
      required: ['path'],
    },
  },
];

async function executeTool(name: string, input: Record<string, unknown>): Promise<string> {
  try {
    switch (name) {
      case 'list_directory': {
        const entries = await window.fileAPI.listDirectory(input.path as string);
        return JSON.stringify(entries.slice(0, 50), null, 2);
      }
      case 'search_files': {
        const results = await window.fileAPI.searchFiles(input.root_path as string, input.query as string);
        return JSON.stringify(results.slice(0, 30), null, 2);
      }
      case 'rename_file': {
        await window.fileAPI.renameFile(input.old_path as string, input.new_path as string);
        return `Renamed successfully`;
      }
      case 'move_files': {
        await window.fileAPI.moveFiles(input.source_paths as string[], input.dest_dir as string);
        return `Moved ${(input.source_paths as string[]).length} item(s) successfully`;
      }
      case 'copy_files': {
        await window.fileAPI.copyFiles(input.source_paths as string[], input.dest_dir as string);
        return `Copied ${(input.source_paths as string[]).length} item(s) successfully`;
      }
      case 'delete_files': {
        await window.fileAPI.deleteFiles(input.paths as string[]);
        return `Deleted ${(input.paths as string[]).length} item(s)`;
      }
      case 'create_folder': {
        await window.fileAPI.createFolder(input.path as string);
        return `Created folder: ${input.path}`;
      }
      case 'open_file': {
        await window.fileAPI.openFile(input.path as string);
        return `Opened: ${input.path}`;
      }
      default:
        return `Unknown tool: ${name}`;
    }
  } catch (err) {
    return `Error: ${(err as Error).message}`;
  }
}

const SYSTEM_PROMPT = `You are a file management assistant. The user is working in a file manager application. You have access to tools to list, search, rename, move, copy, delete files and folders. Always confirm destructive operations before executing. Be concise.`;

export function useChat(currentPath: string, onRefresh: () => void) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const apiMessages = useRef<MessageParam[]>([]);

  const addMessage = useCallback((msg: Omit<ChatMessage, 'id'>) => {
    const id = Date.now().toString() + Math.random().toString(36).slice(2);
    const full = { ...msg, id };
    setMessages((prev) => [...prev, full]);
    return id;
  }, []);

  const updateMessage = useCallback((id: string, update: Partial<ChatMessage>) => {
    setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, ...update } : m)));
  }, []);

  const sendMessage = useCallback(
    async (userText: string, apiKey: string) => {
      if (!userText.trim() || isLoading) return;

      // Add context about current directory
      const contextualText = `[Current directory: ${currentPath}]\n\n${userText}`;

      addMessage({ role: 'user', content: userText });
      apiMessages.current.push({ role: 'user', content: contextualText });

      setIsLoading(true);
      const assistantId = addMessage({ role: 'assistant', content: '', isStreaming: true });

      try {
        const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });

        let continueLoop = true;
        let accumulatedText = '';
        let mutated = false;

        while (continueLoop) {
          const stream = await client.messages.stream({
            model: 'claude-opus-4-5',
            max_tokens: 4096,
            system: SYSTEM_PROMPT,
            tools: FILE_TOOLS,
            messages: apiMessages.current,
          });

          let toolUseBlocks: Array<{ id: string; name: string; input: Record<string, unknown> }> = [];
          let currentToolId = '';
          let currentToolName = '';
          let currentToolInputStr = '';

          for await (const event of stream) {
            if (event.type === 'content_block_start') {
              if (event.content_block.type === 'tool_use') {
                currentToolId = event.content_block.id;
                currentToolName = event.content_block.name;
                currentToolInputStr = '';
              }
            } else if (event.type === 'content_block_delta') {
              if (event.delta.type === 'text_delta') {
                accumulatedText += event.delta.text;
                updateMessage(assistantId, { content: accumulatedText, isStreaming: true });
              } else if (event.delta.type === 'input_json_delta') {
                currentToolInputStr += event.delta.partial_json;
              }
            } else if (event.type === 'content_block_stop') {
              if (currentToolId) {
                try {
                  const parsedInput = JSON.parse(currentToolInputStr || '{}');
                  toolUseBlocks.push({ id: currentToolId, name: currentToolName, input: parsedInput });
                } catch {
                  toolUseBlocks.push({ id: currentToolId, name: currentToolName, input: {} });
                }
                currentToolId = '';
                currentToolName = '';
                currentToolInputStr = '';
              }
            } else if (event.type === 'message_stop') {
              // done streaming
            }
          }

          const finalMessage = await stream.finalMessage();

          // Build assistant message content for history
          apiMessages.current.push({ role: 'assistant', content: finalMessage.content });

          if (finalMessage.stop_reason === 'tool_use' && toolUseBlocks.length > 0) {
            // Execute tools and collect results
            const toolResults: MessageParam = {
              role: 'user',
              content: await Promise.all(
                toolUseBlocks.map(async (tb) => {
                  const result = await executeTool(tb.name, tb.input);
                  // Check if this was a mutating operation
                  if (['rename_file', 'move_files', 'copy_files', 'delete_files', 'create_folder'].includes(tb.name)) {
                    mutated = true;
                  }
                  return {
                    type: 'tool_result' as const,
                    tool_use_id: tb.id,
                    content: result,
                  };
                })
              ),
            };
            apiMessages.current.push(toolResults);
            // Continue the loop to get Claude's response
          } else {
            continueLoop = false;
          }
        }

        updateMessage(assistantId, { isStreaming: false });

        if (mutated) {
          onRefresh();
        }
      } catch (err) {
        const errMsg = (err as Error).message || 'Unknown error';
        updateMessage(assistantId, {
          content: `Error: ${errMsg}`,
          isStreaming: false,
          isError: true,
        });
      } finally {
        setIsLoading(false);
      }
    },
    [currentPath, isLoading, addMessage, updateMessage, onRefresh]
  );

  const clearHistory = useCallback(() => {
    setMessages([]);
    apiMessages.current = [];
  }, []);

  return { messages, isLoading, sendMessage, clearHistory };
}
