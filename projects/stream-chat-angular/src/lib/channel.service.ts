import { Injectable, NgZone } from '@angular/core';
import {
  BehaviorSubject,
  combineLatest,
  Observable,
  ReplaySubject,
} from 'rxjs';
import { filter, first, map, shareReplay } from 'rxjs/operators';
import {
  Attachment,
  Channel,
  ChannelFilters,
  ChannelOptions,
  ChannelResponse,
  ChannelSort,
  Event,
  FormatMessageResponse,
  MessageResponse,
  UpdatedMessage,
  UserResponse,
} from 'stream-chat';
import { ChatClientService, Notification } from './chat-client.service';
import { createMessagePreview } from './message-preview';
import { MessageReactionType } from './message-reactions/message-reactions.component';
import { getReadBy } from './read-by';
import { AttachmentUpload, StreamMessage } from './types';

/**
 * The `ChannelService` provides data and interaction for the channel list and message list. TEST
 */
@Injectable({
  providedIn: 'root',
})
export class ChannelService {
  /**
   * Emits `false` if there are no more pages of channels that can be loaded.
   */
  hasMoreChannels$: Observable<boolean>;
  /**
   * Emits the currently loaded and [watched](https://getstream.io/chat/docs/javascript/watch_channel/?language=javascript) channel list.
   *
   * :::important
   * If you want to subscribe to channel events, you need to manually reenter Angular's change detection zone, our [Change detection guide](../concepts/change-detection.mdx) explains this in detail.
   * :::
   *
   *  Apart from pagination, the channel list is also updated on the following events:
   *
   *  | Event type                          | Default behavior                                                   | Custom handler to override                    |
   *  | ----------------------------------- | ------------------------------------------------------------------ | --------------------------------------------- |
   *  | `channel.deleted`                   | Remove channel from the list                                       | `customChannelDeletedHandler`                 |
   *  | `channel.hidden`                    | Remove channel from the list                                       | `customChannelHiddenHandler`                  |
   *  | `channel.truncated`                 | Updates the channel                                                | `customChannelTruncatedHandler`               |
   *  | `channel.updated`                   | Updates the channel                                                | `customChannelUpdatedHandler`                 |
   *  | `channel.visible`                   | Adds the channel to the list                                       | `customChannelVisibleHandler`                 |
   *  | `message.new`                       | Moves the channel to top of the list                               | `customNewMessageHandler`                     |
   *  | `notification.added_to_channel`     | Adds the new channel to the top of the list and starts watching it | `customAddedToChannelNotificationHandler`     |
   *  | `notification.message_new`          | Adds the new channel to the top of the list and starts watching it | `customNewMessageNotificationHandler`         |
   *  | `notification.removed_from_channel` | Removes the channel from the list                                  | `customRemovedFromChannelNotificationHandler` |
   *
   *  It's important to note that filters don't apply to updates to the list from events.
   *
   *  Our platform documentation covers the topic of [channel events](https://getstream.io/chat/docs/javascript/event_object/?language=javascript#events) in depth.
   */
  channels$: Observable<Channel[] | undefined>;
  /**
   * Emits the currently active channel.
   *
   * :::important
   * If you want to subscribe to channel events, you need to manually reenter Angular's change detection zone, our [Change detection guide](../concepts/change-detection.mdx) explains this in detail.
   * :::
   */
  activeChannel$: Observable<Channel | undefined>;
  /**
   * Emits the list of currently loaded messages of the active channel.
   */
  activeChannelMessages$: Observable<StreamMessage[]>;
  /**
   * Emits the id of the currently selected parent message. If no message is selected, it emits undefined.
   */
  activeParentMessageId$: Observable<string | undefined>;
  /**
   * Emits the list of currently loaded thread replies belonging to the selected parent message. If there is no currently active thread it emits an empty array.
   */
  activeThreadMessages$: Observable<StreamMessage[]>;
  /**
   * Emits the currently selected parent message. If no message is selected, it emits undefined.
   */
  activeParentMessage$: Observable<StreamMessage | undefined>;
  /**
   * Emits the currently selected message to quote
   */
  messageToQuote$: Observable<StreamMessage | undefined>;
  /**
   * Emits the list of users that are currently typing in the channel (current user is not included)
   */
  usersTypingInChannel$: Observable<UserResponse[]>;
  /**
   * Emits the list of users that are currently typing in the active thread (current user is not included)
   */
  usersTypingInThread$: Observable<UserResponse[]>;
  /**
   * Emits a map that contains the date of the latest message sent by the current user by channels (this is used to detect if slow mode countdown should be started)
   */
  latestMessageDateByUserByChannels$: Observable<{ [key: string]: Date }>;
  /**
   * Custom event handler to call if a new message received from a channel that is not being watched, provide an event handler if you want to override the [default channel list ordering](./ChannelService.mdx/#channels)
   */
  customNewMessageNotificationHandler?: (
    notification: Notification,
    channelListSetter: (channels: (Channel | ChannelResponse)[]) => void
  ) => void;
  /**
   * Custom event handler to call when the user is added to a channel, provide an event handler if you want to override the [default channel list ordering](./ChannelService.mdx/#channels)
   */
  customAddedToChannelNotificationHandler?: (
    notification: Notification,
    channelListSetter: (channels: (Channel | ChannelResponse)[]) => void
  ) => void;
  /**
   * Custom event handler to call when the user is removed from a channel, provide an event handler if you want to override the [default channel list ordering](./ChannelService.mdx/#channels)
   */
  customRemovedFromChannelNotificationHandler?: (
    notification: Notification,
    channelListSetter: (channels: (Channel | ChannelResponse)[]) => void
  ) => void;
  /**
   * Custom event handler to call when a channel is deleted, provide an event handler if you want to override the [default channel list ordering](./ChannelService.mdx/#channels)
   */
  customChannelDeletedHandler?: (
    event: Event,
    channel: Channel,
    channelListSetter: (channels: (Channel | ChannelResponse)[]) => void,
    messageListSetter: (messages: StreamMessage[]) => void,
    threadListSetter: (messages: StreamMessage[]) => void,
    parentMessageSetter: (message: StreamMessage | undefined) => void
  ) => void;
  /**
   * Custom event handler to call when a channel is updated, provide an event handler if you want to override the [default channel list ordering](./ChannelService.mdx/#channels)
   */
  customChannelUpdatedHandler?: (
    event: Event,
    channel: Channel,
    channelListSetter: (channels: (Channel | ChannelResponse)[]) => void,
    messageListSetter: (messages: StreamMessage[]) => void,
    threadListSetter: (messages: StreamMessage[]) => void,
    parentMessageSetter: (message: StreamMessage | undefined) => void
  ) => void;
  /**
   * Custom event handler to call when a channel is truncated, provide an event handler if you want to override the [default channel list ordering](./ChannelService.mdx/#channels)
   */
  customChannelTruncatedHandler?: (
    event: Event,
    channel: Channel,
    channelListSetter: (channels: (Channel | ChannelResponse)[]) => void,
    messageListSetter: (messages: StreamMessage[]) => void,
    threadListSetter: (messages: StreamMessage[]) => void,
    parentMessageSetter: (message: StreamMessage | undefined) => void
  ) => void;
  /**
   * Custom event handler to call when a channel becomes hidden, provide an event handler if you want to override the [default channel list ordering](./ChannelService.mdx/#channels)
   */
  customChannelHiddenHandler?: (
    event: Event,
    channel: Channel,
    channelListSetter: (channels: (Channel | ChannelResponse)[]) => void,
    messageListSetter: (messages: StreamMessage[]) => void,
    threadListSetter: (messages: StreamMessage[]) => void,
    parentMessageSetter: (message: StreamMessage | undefined) => void
  ) => void;
  /**
   * Custom event handler to call when a channel becomes visible, provide an event handler if you want to override the [default channel list ordering](./ChannelService.mdx/#channels)
   */
  customChannelVisibleHandler?: (
    event: Event,
    channel: Channel,
    channelListSetter: (channels: (Channel | ChannelResponse)[]) => void,
    messageListSetter: (messages: StreamMessage[]) => void,
    threadListSetter: (messages: StreamMessage[]) => void,
    parentMessageSetter: (message: StreamMessage | undefined) => void
  ) => void;
  /**
   * Custom event handler to call if a new message received from a channel that is being watched, provide an event handler if you want to override the [default channel list ordering](./ChannelService.mdx/#channels)
   */
  customNewMessageHandler?: (
    event: Event,
    channel: Channel,
    channelListSetter: (channels: (Channel | ChannelResponse)[]) => void,
    messageListSetter: (messages: StreamMessage[]) => void,
    threadListSetter: (messages: StreamMessage[]) => void,
    parentMessageSetter: (message: StreamMessage | undefined) => void
  ) => void;
  private channelsSubject = new BehaviorSubject<Channel[] | undefined>(
    undefined
  );
  private activeChannelSubject = new BehaviorSubject<Channel | undefined>(
    undefined
  );
  private activeChannelMessagesSubject = new BehaviorSubject<
    (StreamMessage | MessageResponse | FormatMessageResponse)[]
  >([]);
  private hasMoreChannelsSubject = new ReplaySubject<boolean>(1);
  private activeChannelSubscriptions: { unsubscribe: () => void }[] = [];
  private activeParentMessageIdSubject = new BehaviorSubject<
    string | undefined
  >(undefined);
  private activeThreadMessagesSubject = new BehaviorSubject<
    (StreamMessage | MessageResponse | FormatMessageResponse)[]
  >([]);
  private latestMessageDateByUserByChannelsSubject = new BehaviorSubject<{
    [key: string]: Date;
  }>({});
  private filters: ChannelFilters | undefined;
  private sort: ChannelSort | undefined;
  private options: ChannelOptions | undefined;
  private readonly messagePageSize = 25;
  private messageToQuoteSubject = new BehaviorSubject<
    StreamMessage | undefined
  >(undefined);
  private usersTypingInChannelSubject = new BehaviorSubject<UserResponse[]>([]);
  private usersTypingInThreadSubject = new BehaviorSubject<UserResponse[]>([]);

  private channelListSetter = (channels: (Channel | ChannelResponse)[]) => {
    const currentChannels = this.channelsSubject.getValue() || [];
    const newChannels = channels.filter(
      (c) => !currentChannels.find((channel) => channel.cid === c.cid)
    );
    const deletedChannels = currentChannels.filter(
      (c) => !channels?.find((channel) => channel.cid === c.cid)
    );
    this.addChannelsFromNotification(newChannels as ChannelResponse[]);
    this.removeChannelsFromChannelList(deletedChannels.map((c) => c.cid));
    if (!newChannels.length && !deletedChannels.length) {
      this.channelsSubject.next(channels as Channel[]);
    }
  };

  private messageListSetter = (messages: StreamMessage[]) => {
    this.activeChannelMessagesSubject.next(messages);
  };

  private threadListSetter = (messages: StreamMessage[]) => {
    this.activeThreadMessagesSubject.next(messages);
  };

  private parentMessageSetter = (message: StreamMessage | undefined) => {
    this.activeParentMessageIdSubject.next(message?.id);
  };

  constructor(
    private chatClientService: ChatClientService,
    private ngZone: NgZone
  ) {
    this.channels$ = this.channelsSubject.asObservable();
    this.activeChannel$ = this.activeChannelSubject.asObservable();
    this.activeChannelMessages$ = this.activeChannelMessagesSubject.pipe(
      map((messages) => {
        const channel = this.activeChannelSubject.getValue()!;
        return messages.map((message) =>
          this.transformToStreamMessage(message, channel)
        );
      })
    );
    this.hasMoreChannels$ = this.hasMoreChannelsSubject.asObservable();
    this.activeParentMessageId$ =
      this.activeParentMessageIdSubject.asObservable();
    this.activeThreadMessages$ = this.activeThreadMessagesSubject.pipe(
      map((messages) => {
        const channel = this.activeChannelSubject.getValue()!;
        return messages.map((message) =>
          this.transformToStreamMessage(message, channel)
        );
      })
    );
    this.activeParentMessage$ = combineLatest([
      this.activeChannelMessages$,
      this.activeParentMessageId$,
    ]).pipe(
      map(
        ([messages, parentMessageId]: [
          StreamMessage[],
          string | undefined
        ]) => {
          if (!parentMessageId) {
            return undefined;
          } else {
            return messages.find((m) => m.id === parentMessageId);
          }
        }
      ),
      shareReplay()
    );
    this.messageToQuote$ = this.messageToQuoteSubject.asObservable();

    this.chatClientService.connectionState$
      .pipe(filter((s) => s === 'online'))
      .subscribe(() => {
        void this.setAsActiveParentMessage(undefined);
      });

    this.usersTypingInChannel$ =
      this.usersTypingInChannelSubject.asObservable();
    this.usersTypingInThread$ = this.usersTypingInThreadSubject.asObservable();
    this.latestMessageDateByUserByChannels$ =
      this.latestMessageDateByUserByChannelsSubject.asObservable();
  }

  /**
   * Sets the given `channel` as active.
   * @param channel
   */
  setAsActiveChannel(channel: Channel) {
    const prevActiveChannel = this.activeChannelSubject.getValue();
    this.stopWatchForActiveChannelEvents(prevActiveChannel);
    this.watchForActiveChannelEvents(channel);
    this.activeChannelSubject.next(channel);
    channel.state.messages.forEach((m) => {
      m.readBy = getReadBy(m, channel);
    });
    if (this.canSendReadEvents) {
      void channel.markRead();
    }
    this.activeChannelMessagesSubject.next([...channel.state.messages]);
    this.activeParentMessageIdSubject.next(undefined);
    this.activeThreadMessagesSubject.next([]);
    this.messageToQuoteSubject.next(undefined);
  }

  /**
   * Deselects the currently active (if any) channel
   */
  deselectActiveChannel() {
    const activeChannel = this.activeChannelSubject.getValue();
    if (!activeChannel) {
      return;
    }
    this.activeChannelMessagesSubject.next([]);
    this.activeChannelSubject.next(undefined);
    this.activeParentMessageIdSubject.next(undefined);
    this.activeThreadMessagesSubject.next([]);
    this.latestMessageDateByUserByChannelsSubject.next({});
    this.selectMessageToQuote(undefined);
  }

  /**
   * Sets the given `message` as an active parent message. If `undefined` is provided, it will deleselect the current parent message.
   * @param message
   */
  async setAsActiveParentMessage(message: StreamMessage | undefined) {
    const messageToQuote = this.messageToQuoteSubject.getValue();
    if (messageToQuote && !!messageToQuote.parent_id) {
      this.messageToQuoteSubject.next(undefined);
    }
    if (!message) {
      this.activeParentMessageIdSubject.next(undefined);
      this.activeThreadMessagesSubject.next([]);
    } else {
      this.activeParentMessageIdSubject.next(message.id);
      const activeChannel = this.activeChannelSubject.getValue();
      const result = await activeChannel?.getReplies(message.id, {
        limit: this.options?.message_limit,
      });
      this.activeThreadMessagesSubject.next(result?.messages || []);
    }
  }

  /**
   * Loads the next page of messages of the active channel. The page size can be set in the [query option](https://getstream.io/chat/docs/javascript/query_channels/?language=javascript#query-options) object.
   */
  async loadMoreMessages() {
    const activeChnannel = this.activeChannelSubject.getValue();
    const lastMessageId = this.activeChannelMessagesSubject.getValue()[0]?.id;
    await activeChnannel?.query({
      messages: { limit: this.options?.message_limit, id_lt: lastMessageId },
      members: { limit: 0 },
      watchers: { limit: 0 },
    });
    if (
      activeChnannel?.data?.id ===
      this.activeChannelSubject.getValue()?.data?.id
    ) {
      this.activeChannelMessagesSubject.next([
        ...activeChnannel!.state.messages,
      ]);
    }
  }

  /**
   * Loads the next page of messages of the active thread. The page size can be set in the [query option](https://getstream.io/chat/docs/javascript/query_channels/?language=javascript#query-options) object.
   */
  async loadMoreThreadReplies() {
    const activeChnannel = this.activeChannelSubject.getValue();
    const parentMessageId = this.activeParentMessageIdSubject.getValue();
    if (!parentMessageId) {
      return;
    }
    const lastMessageId = this.activeThreadMessagesSubject.getValue()[0]?.id;
    await activeChnannel?.getReplies(parentMessageId, {
      limit: this.options?.message_limit,
      id_lt: lastMessageId,
    });
    this.activeThreadMessagesSubject.next(
      activeChnannel?.state.threads[parentMessageId] || []
    );
  }

  /**
   * Queries the channels with the given filters, sorts and options. More info about [channel querying](https://getstream.io/chat/docs/javascript/query_channels/?language=javascript) can be found in the platform documentation.
   * @param filters
   * @param sort
   * @param options
   * @param shouldSetActiveChannel Decides if the first channel in the result should be made as an active channel, or no channel should be marked as active
   * @returns the list of channels found by the query
   */
  async init(
    filters: ChannelFilters,
    sort?: ChannelSort,
    options?: ChannelOptions,
    shouldSetActiveChannel: boolean = true
  ) {
    this.filters = filters;
    this.options = options || {
      offset: 0,
      limit: 25,
      state: true,
      presence: true,
      watch: true,
      message_limit: this.messagePageSize,
    };
    this.sort = sort || { last_message_at: -1, updated_at: -1 };
    const result = await this.queryChannels(shouldSetActiveChannel);
    this.chatClientService.notification$.subscribe(
      (notification) => void this.handleNotification(notification)
    );
    return result;
  }

  /**
   * Resets the `activeChannel$`, `channels$` and `activeChannelMessages$` Observables. Useful when disconnecting a chat user, use in combination with [`disconnectUser`](./ChatClientService.mdx/#disconnectuser).
   */
  reset() {
    this.deselectActiveChannel();
    this.channelsSubject.next(undefined);
  }

  /**
   * Loads the next page of channels. The page size can be set in the [query option](https://getstream.io/chat/docs/javascript/query_channels/?language=javascript#query-options) object.
   */
  async loadMoreChannels() {
    this.options!.offset = this.channels.length!;
    await this.queryChannels(false);
  }

  /**
   * Adds a reaction to a message.
   * @param messageId The id of the message to add the reaction to
   * @param reactionType The type of the reaction
   */
  async addReaction(messageId: string, reactionType: MessageReactionType) {
    await this.activeChannelSubject.getValue()?.sendReaction(messageId, {
      type: reactionType,
    });
  }

  /**
   * Removes a reaction from a message.
   * @param messageId The id of the message to remove the reaction from
   * @param reactionType Thr type of reaction to remove
   */
  async removeReaction(messageId: string, reactionType: MessageReactionType) {
    await this.activeChannelSubject
      .getValue()
      ?.deleteReaction(messageId, reactionType);
  }

  /**
   * Sends a message to the active channel. The message is immediately added to the message list, if an error occurs and the message can't be sent, the error is indicated in `state` of the message.
   * @param text The text of the message
   * @param attachments The attachments
   * @param mentionedUsers Mentioned users
   * @param parentId Id of the parent message (if sending a thread reply)
   * @param quotedMessageId Id of the message to quote (if sending a quote reply)
   */
  async sendMessage(
    text: string,
    attachments: Attachment[] = [],
    mentionedUsers: UserResponse[] = [],
    parentId: string | undefined = undefined,
    quotedMessageId: string | undefined = undefined
  ) {
    const preview = createMessagePreview(
      this.chatClientService.chatClient.user!,
      text,
      attachments,
      mentionedUsers,
      parentId,
      quotedMessageId
    );
    const channel = this.activeChannelSubject.getValue()!;
    preview.readBy = [];
    channel.state.addMessageSorted(preview, true);
    await this.sendMessageRequest(preview);
  }

  /**
   * Resends the given message to the active channel
   * @param message The message to resend
   */
  async resendMessage(message: StreamMessage) {
    const channel = this.activeChannelSubject.getValue()!;
    channel.state.addMessageSorted(
      {
        ...(message as any as MessageResponse),
        errorStatusCode: undefined,
        status: 'sending',
      },
      true
    );
    await this.sendMessageRequest(message);
  }

  /**
   * Updates the message in the active channel
   * @param message Mesage to be updated
   */
  async updateMessage(message: StreamMessage) {
    await this.chatClientService.chatClient.updateMessage(
      message as UpdatedMessage
    );
  }

  /**
   * Deletes the message from the active channel
   * @param message Message to be deleted
   */
  async deleteMessage(message: StreamMessage) {
    await this.chatClientService.chatClient.deleteMessage(message.id);
  }

  /**
   * Uploads files to the channel. If you want to know more about [file uploads](https://getstream.io/chat/docs/javascript/file_uploads/?language=javascript) check out the platform documentation.
   * @param uploads the attachments to upload (output of the [`AttachmentService`](./AttachmentService.mdx))
   * @returns the result of file upload requests
   */
  async uploadAttachments(
    uploads: AttachmentUpload[]
  ): Promise<AttachmentUpload[]> {
    const result: AttachmentUpload[] = [];
    const channel = this.activeChannelSubject.getValue()!;
    const uploadResults = await Promise.allSettled(
      uploads.map((upload) =>
        upload.type === 'image'
          ? channel.sendImage(upload.file)
          : channel.sendFile(upload.file)
      )
    );
    uploadResults.forEach((uploadResult, i) => {
      const file = uploads[i].file;
      const type = uploads[i].type;
      if (uploadResult.status === 'fulfilled') {
        result.push({
          file,
          type,
          state: 'success',
          url: uploadResult.value.file,
        });
      } else {
        result.push({ file, type, state: 'error' });
      }
    });

    return result;
  }

  /**
   * Deletes an uploaded file by URL. If you want to know more about [file uploads](https://getstream.io/chat/docs/javascript/file_uploads/?language=javascript) check out the platform documentation
   * @param attachmentUpload Attachment to be deleted (output of the [`AttachmentService`](./AttachmentService.mdx))
   */
  async deleteAttachment(attachmentUpload: AttachmentUpload) {
    const channel = this.activeChannelSubject.getValue()!;
    await (attachmentUpload.type === 'image'
      ? channel.deleteImage(attachmentUpload.url!)
      : channel.deleteFile(attachmentUpload.url!));
  }

  /**
   * Returns the autocomplete options for current channel members. If the channel has less than 100 members, it returns the channel members, otherwise sends a [search request](https://getstream.io/chat/docs/javascript/query_members/?language=javascript#pagination-and-ordering) with the given search term.
   * @param searchTerm Text to search for in the names of members
   * @returns The list of members matching the search filter
   */
  async autocompleteMembers(searchTerm: string) {
    const activeChannel = this.activeChannelSubject.getValue();
    if (!activeChannel) {
      return [];
    }
    if (Object.keys(activeChannel.state.members).length <= 100) {
      return Object.values(activeChannel.state.members).filter(
        (m) => m.user?.id !== this.chatClientService.chatClient.userID!
      );
    } else {
      if (!searchTerm) {
        return [];
      }
      const result = await activeChannel.queryMembers({
        name: { $autocomplete: searchTerm },
        id: { $ne: this.chatClientService.chatClient.userID! },
      });
      return Object.values(result.members);
    }
  }

  /**
   * [Runs a message action](https://getstream.io/chat/docs/rest/#messages-runmessageaction) in the current channel. Updates the message list based on the action result (if no message is returned, the message will be removed from the message list).
   * @param messageId
   * @param formData
   */
  async sendAction(messageId: string, formData: Record<string, string>) {
    const channel = this.activeChannelSubject.getValue()!;
    const response = await channel.sendAction(messageId, formData);
    if (response?.message) {
      channel.state.addMessageSorted({
        ...response.message,
        status: 'received',
      });
      const isThreadReply = !!response.message.parent_id;
      isThreadReply
        ? this.activeThreadMessagesSubject.next([
            ...channel.state.threads[response.message.parent_id!],
          ])
        : this.activeChannelMessagesSubject.next([...channel.state.messages]);
    } else {
      channel.state.removeMessage({ id: messageId });
      if (
        this.activeChannelMessagesSubject
          .getValue()
          .find((m) => m.id === messageId)
      ) {
        this.activeChannelMessagesSubject.next([...channel.state.messages]);
      } else if (
        this.activeThreadMessagesSubject
          .getValue()
          .find((m) => m.id === messageId)
      ) {
        this.activeThreadMessagesSubject.next(
          channel.state.threads[this.activeParentMessageIdSubject.getValue()!]
        );
      }
    }
  }

  /**
   * Selects or deselects the current message to quote reply to
   * @param message The message to select, if called with `undefined`, it deselects the message
   */
  selectMessageToQuote(message: StreamMessage | undefined) {
    this.messageToQuoteSubject.next(message);
  }

  private async sendMessageRequest(preview: MessageResponse | StreamMessage) {
    const channel = this.activeChannelSubject.getValue()!;
    const isThreadReply = !!preview.parent_id;
    isThreadReply
      ? this.activeThreadMessagesSubject.next([
          ...channel.state.threads[preview.parent_id!],
        ])
      : this.activeChannelMessagesSubject.next([...channel.state.messages]);
    try {
      const response = await channel.sendMessage({
        text: preview.text,
        attachments: preview.attachments,
        mentioned_users: preview.mentioned_users?.map((u) => u.id),
        id: preview.id,
        parent_id: preview.parent_id,
        quoted_message_id: preview.quoted_message_id,
      });
      if (response?.message) {
        channel.state.addMessageSorted(
          {
            ...response.message,
            status: 'received',
          },
          true
        );
        isThreadReply
          ? this.activeThreadMessagesSubject.next([
              ...channel.state.threads[preview.parent_id!],
            ])
          : this.activeChannelMessagesSubject.next([...channel.state.messages]);
      }
    } catch (error) {
      const stringError = JSON.stringify(error);
      const parsedError: { status?: number } = stringError
        ? (JSON.parse(stringError) as { status?: number })
        : {};

      channel.state.addMessageSorted(
        {
          ...(preview as MessageResponse),
          errorStatusCode: parsedError.status || undefined,
          status: 'failed',
        },
        true
      );
      isThreadReply
        ? this.activeThreadMessagesSubject.next([
            ...channel.state.threads[preview.parent_id!],
          ])
        : this.activeChannelMessagesSubject.next([...channel.state.messages]);
    }
  }

  private handleNotification(notification: Notification) {
    switch (notification.eventType) {
      case 'notification.message_new': {
        this.ngZone.run(() => {
          if (this.customNewMessageNotificationHandler) {
            this.customNewMessageNotificationHandler(
              notification,
              this.channelListSetter
            );
          } else {
            this.handleNewMessageNotification(notification);
          }
        });
        break;
      }
      case 'notification.added_to_channel': {
        this.ngZone.run(() => {
          if (this.customAddedToChannelNotificationHandler) {
            this.customAddedToChannelNotificationHandler(
              notification,
              this.channelListSetter
            );
          } else {
            this.handleAddedToChannelNotification(notification);
          }
        });
        break;
      }
      case 'notification.removed_from_channel': {
        this.ngZone.run(() => {
          if (this.customRemovedFromChannelNotificationHandler) {
            this.customRemovedFromChannelNotificationHandler(
              notification,
              this.channelListSetter
            );
          } else {
            this.handleRemovedFromChannelNotification(notification);
          }
        });
      }
    }
  }

  private handleRemovedFromChannelNotification(notification: Notification) {
    const channelIdToBeRemoved = notification.event.channel!.cid;
    this.removeChannelsFromChannelList([channelIdToBeRemoved]);
  }

  private handleNewMessageNotification(notification: Notification) {
    if (notification.event.channel) {
      this.addChannelsFromNotification([notification.event.channel]);
    }
  }

  private handleAddedToChannelNotification(notification: Notification) {
    if (notification.event.channel) {
      this.addChannelsFromNotification([notification.event.channel]);
    }
  }

  private addChannelsFromNotification(channelResponses: ChannelResponse[]) {
    const newChannels: Channel[] = [];
    channelResponses.forEach((channelResponse) => {
      const channel = this.chatClientService.chatClient.channel(
        channelResponse.type,
        channelResponse.id
      );
      void channel.watch();
      this.watchForChannelEvents(channel);
      newChannels.push(channel);
    });
    this.channelsSubject.next([
      ...newChannels,
      ...(this.channelsSubject.getValue() || []),
    ]);
  }

  private removeChannelsFromChannelList(cids: string[]) {
    const channels = this.channels.filter((c) => !cids.includes(c.cid || ''));
    if (channels.length < this.channels.length) {
      this.channelsSubject.next(channels);
      if (cids.includes(this.activeChannelSubject.getValue()?.cid || '')) {
        if (channels.length > 0) {
          this.setAsActiveChannel(channels[0]);
        } else {
          this.activeChannelSubject.next(undefined);
        }
      }
    }
  }

  private watchForActiveChannelEvents(channel: Channel) {
    this.activeChannelSubscriptions.push(
      channel.on('message.new', (event) => {
        this.ngZone.run(() => {
          event.message && event.message.parent_id
            ? this.activeThreadMessagesSubject.next([
                ...channel.state.threads[event.message.parent_id],
              ])
            : this.activeChannelMessagesSubject.next([
                ...channel.state.messages,
              ]);
          this.activeChannel$.pipe(first()).subscribe((c) => {
            if (this.canSendReadEvents) {
              void c?.markRead();
            }
          });
          this.updateLatestMessages(event);
        });
      })
    );
    this.activeChannelSubscriptions.push(
      channel.on('message.updated', (event) => this.messageUpdated(event))
    );
    this.activeChannelSubscriptions.push(
      channel.on('message.deleted', (event) => this.messageUpdated(event))
    );
    this.activeChannelSubscriptions.push(
      channel.on('reaction.new', (e) => this.messageReactionEventReceived(e))
    );
    this.activeChannelSubscriptions.push(
      channel.on('reaction.deleted', (e) =>
        this.messageReactionEventReceived(e)
      )
    );
    this.activeChannelSubscriptions.push(
      channel.on('reaction.updated', (e) =>
        this.messageReactionEventReceived(e)
      )
    );
    this.activeChannelSubscriptions.push(
      channel.on('message.read', (e) => {
        this.ngZone.run(() => {
          let latestMessage!: StreamMessage;
          this.activeChannelMessages$.pipe(first()).subscribe((messages) => {
            latestMessage = messages[messages.length - 1];
          });
          if (!latestMessage || !e.user) {
            return;
          }
          latestMessage.readBy = getReadBy(latestMessage, channel);

          this.activeChannelMessagesSubject.next(
            this.activeChannelMessagesSubject.getValue()
          );
        });
      })
    );
    this.activeChannelSubscriptions.push(
      channel.on('typing.start', (e) =>
        this.ngZone.run(() => this.handleTypingStartEvent(e))
      )
    );
    this.activeChannelSubscriptions.push(
      channel.on('typing.stop', (e) =>
        this.ngZone.run(() => this.handleTypingStopEvent(e))
      )
    );
  }

  /**
   * Call this method if user started typing in the active channel
   * @param parentId The id of the parent message, if user is typing in a thread
   */
  async typingStarted(parentId?: string) {
    const activeChannel = this.activeChannelSubject.getValue();
    await activeChannel?.keystroke(parentId);
  }

  /**
   * Call this method if user stopped typing in the active channel
   * @param parentId The id of the parent message, if user were typing in a thread
   */
  async typingStopped(parentId?: string) {
    const activeChannel = this.activeChannelSubject.getValue();
    await activeChannel?.stopTyping(parentId);
  }

  private messageUpdated(event: Event) {
    this.ngZone.run(() => {
      const isThreadReply = event.message && event.message.parent_id;
      const messages = isThreadReply
        ? this.activeThreadMessagesSubject.getValue()
        : this.activeChannelMessagesSubject.getValue();
      const messageIndex = messages.findIndex(
        (m) => m.id === event.message?.id
      );
      if (messageIndex !== -1 && event.message) {
        messages[messageIndex] = event.message;
        isThreadReply
          ? this.activeThreadMessagesSubject.next([...messages])
          : this.activeChannelMessagesSubject.next([...messages]);
      }
    });
  }

  private messageReactionEventReceived(e: Event) {
    this.ngZone.run(() => {
      const isThreadMessage = e.message && e.message.parent_id;
      let messages!: StreamMessage[];
      (isThreadMessage
        ? this.activeThreadMessages$
        : this.activeChannelMessages$
      )
        .pipe(first())
        .subscribe((m) => (messages = m));
      const message = messages.find((m) => m.id === e?.message?.id);
      if (!message) {
        return;
      }
      message.reaction_counts = { ...e.message?.reaction_counts };
      message.reaction_scores = { ...e.message?.reaction_scores };
      message.latest_reactions = [...(e.message?.latest_reactions || [])];
      message.own_reactions = [...(e.message?.own_reactions || [])];
      isThreadMessage
        ? this.activeThreadMessagesSubject.next([...messages])
        : this.activeChannelMessagesSubject.next([...messages]);
    });
  }

  private formatMessage(message: MessageResponse) {
    return {
      ...message,
      // parse the date..
      pinned_at: message.pinned_at ? new Date(message.pinned_at) : null,
      created_at: message.created_at
        ? new Date(message.created_at)
        : new Date(),
      updated_at: message.updated_at
        ? new Date(message.updated_at)
        : new Date(),
      status: message.status || 'received',
    };
  }

  private isStreamMessage(
    message: StreamMessage | FormatMessageResponse | MessageResponse
  ): message is StreamMessage {
    return !!message.readBy;
  }

  private isFormatMessageResponse(
    message: StreamMessage | FormatMessageResponse | MessageResponse
  ): message is FormatMessageResponse {
    return message.created_at instanceof Date;
  }

  private stopWatchForActiveChannelEvents(channel: Channel | undefined) {
    if (!channel) {
      return;
    }
    this.activeChannelSubscriptions.forEach((s) => s.unsubscribe());
    this.activeChannelSubscriptions = [];
  }

  private async queryChannels(shouldSetActiveChannel: boolean) {
    try {
      const channels = await this.chatClientService.chatClient.queryChannels(
        this.filters!,
        this.sort,
        this.options
      );
      channels.forEach((c) => this.watchForChannelEvents(c));
      const prevChannels = this.channelsSubject.getValue() || [];
      this.channelsSubject.next([...prevChannels, ...channels]);
      if (
        channels.length > 0 &&
        !this.activeChannelSubject.getValue() &&
        shouldSetActiveChannel
      ) {
        this.setAsActiveChannel(channels[0]);
      }
      this.hasMoreChannelsSubject.next(channels.length >= this.options!.limit!);
      return channels;
    } catch (error) {
      this.channelsSubject.error(error);
      throw error;
    }
  }

  private watchForChannelEvents(channel: Channel) {
    channel.on((event: Event) => {
      switch (event.type) {
        case 'message.new': {
          this.ngZone.run(() => {
            if (this.customNewMessageHandler) {
              this.customNewMessageHandler(
                event,
                channel,
                this.channelListSetter,
                this.messageListSetter,
                this.threadListSetter,
                this.parentMessageSetter
              );
            } else {
              this.handleNewMessage(event, channel);
            }
          });
          break;
        }
        case 'channel.hidden': {
          this.ngZone.run(() => {
            if (this.customChannelHiddenHandler) {
              this.customChannelHiddenHandler(
                event,
                channel,
                this.channelListSetter,
                this.messageListSetter,
                this.threadListSetter,
                this.parentMessageSetter
              );
            } else {
              this.handleChannelHidden(event);
            }
          });
          break;
        }
        case 'channel.deleted': {
          this.ngZone.run(() => {
            if (this.customChannelDeletedHandler) {
              this.customChannelDeletedHandler(
                event,
                channel,
                this.channelListSetter,
                this.messageListSetter,
                this.threadListSetter,
                this.parentMessageSetter
              );
            } else {
              this.handleChannelDeleted(event);
            }
          });
          break;
        }
        case 'channel.visible': {
          this.ngZone.run(() => {
            if (this.customChannelVisibleHandler) {
              this.customChannelVisibleHandler(
                event,
                channel,
                this.channelListSetter,
                this.messageListSetter,
                this.threadListSetter,
                this.parentMessageSetter
              );
            } else {
              this.handleChannelVisible(event, channel);
            }
          });
          break;
        }
        case 'channel.updated': {
          this.ngZone.run(() => {
            if (this.customChannelUpdatedHandler) {
              this.customChannelUpdatedHandler(
                event,
                channel,
                this.channelListSetter,
                this.messageListSetter,
                this.threadListSetter,
                this.parentMessageSetter
              );
            } else {
              this.handleChannelUpdate(event);
            }
          });
          break;
        }
        case 'channel.truncated': {
          this.ngZone.run(() => {
            if (this.customChannelTruncatedHandler) {
              this.customChannelTruncatedHandler(
                event,
                channel,
                this.channelListSetter,
                this.messageListSetter,
                this.threadListSetter,
                this.parentMessageSetter
              );
            } else {
              this.handleChannelTruncate(event);
            }
          });
          break;
        }
      }
    });
  }

  private handleNewMessage(_: Event, channel: Channel) {
    const channelIndex = this.channels.findIndex((c) => c.cid === channel.cid);
    this.channels.splice(channelIndex, 1);
    this.channelsSubject.next([channel, ...this.channels]);
  }

  private handleChannelHidden(event: Event) {
    this.removeChannelsFromChannelList([event.channel!.cid]);
  }

  private handleChannelDeleted(event: Event) {
    this.removeChannelsFromChannelList([event.channel!.cid]);
  }

  private handleChannelVisible(event: Event, channel: Channel) {
    if (!this.channels.find((c) => c.cid === event.cid)) {
      this.ngZone.run(() =>
        this.channelsSubject.next([...this.channels, channel])
      );
    }
  }

  private handleChannelUpdate(event: Event) {
    const channelIndex = this.channels.findIndex(
      (c) => c.cid === event.channel!.cid
    );
    if (channelIndex !== -1) {
      this.channels[channelIndex].data = event.channel;
      this.channelsSubject.next([...this.channels]);
      if (event.channel?.cid === this.activeChannelSubject.getValue()?.cid) {
        const channel = this.activeChannelSubject.getValue()!;
        channel.data = event.channel;
        this.activeChannelSubject.next(channel);
      }
    }
  }

  private handleChannelTruncate(event: Event) {
    const channelIndex = this.channels.findIndex(
      (c) => c.cid === event.channel!.cid
    );
    if (channelIndex !== -1) {
      this.channels[channelIndex].state.messages = [];
      this.channelsSubject.next([...this.channels]);
      if (event.channel?.cid === this.activeChannelSubject.getValue()?.cid) {
        const channel = this.activeChannelSubject.getValue()!;
        channel.state.messages = [];
        this.activeChannelSubject.next(channel);
        this.activeChannelMessagesSubject.next([]);
        this.activeParentMessageIdSubject.next(undefined);
        this.activeThreadMessagesSubject.next([]);
      }
    }
  }

  private get channels() {
    return this.channelsSubject.getValue() || [];
  }

  private get canSendReadEvents() {
    const channel = this.activeChannelSubject.getValue();
    if (!channel) {
      return false;
    }
    const capabilites = channel.data?.own_capabilities as string[];
    return capabilites.indexOf('read-events') !== -1;
  }

  private transformToStreamMessage(
    message: StreamMessage | MessageResponse | FormatMessageResponse,
    channel: Channel
  ) {
    const isThreadMessage = !!message.parent_id;
    if (
      this.isStreamMessage(message) &&
      this.isFormatMessageResponse(message)
    ) {
      return message;
    } else if (this.isFormatMessageResponse(message)) {
      return {
        ...message,
        readBy: isThreadMessage ? [] : getReadBy(message, channel),
      };
    } else {
      const formatMessage = this.formatMessage(message);
      return {
        ...formatMessage,
        readBy: isThreadMessage ? [] : getReadBy(formatMessage, channel),
      };
    }
  }

  private handleTypingStartEvent(event: Event) {
    if (event.user?.id === this.chatClientService.chatClient.user?.id) {
      return;
    }
    const isTypingInThread = !!event.parent_id;
    if (
      isTypingInThread &&
      event.parent_id !== this.activeParentMessageIdSubject.getValue()
    ) {
      return;
    }
    const subject = isTypingInThread
      ? this.usersTypingInThreadSubject
      : this.usersTypingInChannelSubject;
    const users: UserResponse[] = subject.getValue();
    const user = event.user;
    if (user && !users.find((u) => u.id === user.id)) {
      users.push(user);
      subject.next([...users]);
    }
  }

  private handleTypingStopEvent(event: Event) {
    const usersTypingInChannel = this.usersTypingInChannelSubject.getValue();
    const usersTypingInThread = this.usersTypingInThreadSubject.getValue();
    const user = event.user;
    if (user && usersTypingInChannel.find((u) => u.id === user.id)) {
      usersTypingInChannel.splice(
        usersTypingInChannel.findIndex((u) => u.id === user.id),
        1
      );
      this.usersTypingInChannelSubject.next([...usersTypingInChannel]);
      return;
    }
    if (user && usersTypingInThread.find((u) => u.id === user.id)) {
      usersTypingInThread.splice(
        usersTypingInThread.findIndex((u) => u.id === user.id),
        1
      );
      this.usersTypingInThreadSubject.next([...usersTypingInThread]);
      return;
    }
  }

  private updateLatestMessages(event: Event) {
    if (
      event.message?.user?.id !== this.chatClientService?.chatClient.user?.id
    ) {
      return;
    }
    const latestMessages =
      this.latestMessageDateByUserByChannelsSubject.getValue();
    if (!event.message?.created_at) {
      return;
    }
    const channelId = event?.message?.cid;
    if (!channelId) {
      return;
    }
    const messageDate = new Date(event.message.created_at);
    if (
      !latestMessages[channelId] ||
      latestMessages[channelId]?.getTime() < messageDate.getTime()
    ) {
      latestMessages[channelId] = messageDate;
      this.latestMessageDateByUserByChannelsSubject.next({
        ...latestMessages,
      });
    }
  }
}
