import {
  Component,
  ElementRef,
  EventEmitter,
  HostBinding,
  Input,
  OnChanges,
  Output,
  SimpleChanges,
  TemplateRef,
  ViewChild,
} from '@angular/core';
import { MentionConfig, Mentions } from 'angular-mentions';
import {
  MentionAutcompleteListItemContext,
  MentionAutcompleteListItem,
  CommandAutocompleteListItemContext,
} from '../../types';

import { BehaviorSubject, Subscription } from 'rxjs';
import { UserResponse } from 'stream-chat';
import { ChannelService } from '../../channel.service';
import { TextareaInterface } from '../textarea.interface';
import { ChatClientService } from '../../chat-client.service';
import { debounceTime, distinctUntilChanged } from 'rxjs/operators';
import { TransliterationService } from '../../transliteration.service';
import { EmojiInputService } from '../emoji-input.service';

/**
 * The `AutocompleteTextarea` component is used by the [`MessageInput`](./MessageInputComponent.mdx) component to display the input HTML element where users can type their message.
 */
@Component({
  selector: 'stream-autocomplete-textarea',
  templateUrl: './autocomplete-textarea.component.html',
  styles: [],
})
export class AutocompleteTextareaComponent
  implements TextareaInterface, OnChanges
{
  @HostBinding() class = 'str-chat__textarea';
  /**
   * The value of the input HTML element.
   */
  @Input() value = '';
  /**
   * If true, users can mention other users in messages. You can also set this input on the [`MessageInput`](./MessageInputComponent.mdx/#inputs-and-outputs) component.
   */
  @Input() areMentionsEnabled: boolean | undefined = true;
  /**
   * You can provide your own template for the autocomplete list for user mentions. You can also set this input on the [`MessageInput`](./MessageInputComponent.mdx/#inputs-and-outputs) component.
   */
  @Input() mentionAutocompleteItemTemplate:
    | TemplateRef<MentionAutcompleteListItemContext>
    | undefined;
  /**
   * You can provide your own template for the autocomplete list for commands. You can also set this input on the [`MessageInput`](./MessageInputComponent.mdx/#inputs-and-outputs) component.
   */
  @Input() commandAutocompleteItemTemplate:
    | TemplateRef<CommandAutocompleteListItemContext>
    | undefined;
  /**
   * The scope for user mentions, either members of the current channel of members of the application. You can also set this input on the [`MessageInput`](./MessageInputComponent.mdx/#inputs-and-outputs) component.
   */
  @Input() mentionScope: 'channel' | 'application' = 'channel';
  /**
   * Emits the current value of the input element when a user types.
   */
  @Output() readonly valueChange = new EventEmitter<string>();
  /**
   * Emits when a user triggers a message send event (this happens when they hit the `Enter` key).
   */
  @Output() readonly send = new EventEmitter<void>();
  /**
   * Emits the array of users that are mentioned in the message, it is updated when a user mentions a new user or deletes a mention.
   */
  @Output() readonly userMentions = new EventEmitter<UserResponse[]>();
  private readonly autocompleteKey = 'autocompleteLabel';
  private readonly mentionTriggerChar = '@';
  private readonly commandTriggerChar = '/';
  autocompleteConfig: MentionConfig = {
    mentions: [],
  };
  @ViewChild('input') private messageInput!: ElementRef<HTMLInputElement>;
  private subscriptions: Subscription[] = [];
  private mentionedUsers: UserResponse[] = [];
  private userMentionConfig: Mentions = {
    triggerChar: this.mentionTriggerChar,
    dropUp: true,
    labelKey: this.autocompleteKey,
    returnTrigger: true,
    mentionFilter: (
      searchString: string,
      items: { autocompleteLabel: string }[]
    ) => this.filter(searchString, items),
    mentionSelect: (item, triggerChar) =>
      this.itemSelectedFromAutocompleteList(item, triggerChar),
  };
  private slashCommandConfig: Mentions = {
    triggerChar: this.commandTriggerChar,
    dropUp: true,
    labelKey: 'name',
    returnTrigger: true,
    mentionFilter: (
      searchString: string,
      items: { autocompleteLabel: string }[]
    ) => this.filter(searchString, items),
    mentionSelect: (item, triggerChar) =>
      this.itemSelectedFromAutocompleteList(item, triggerChar),
  };
  private searchTerm$ = new BehaviorSubject<string>('');

  constructor(
    private channelService: ChannelService,
    private chatClientService: ChatClientService,
    private transliterationService: TransliterationService,
    private emojiInputService: EmojiInputService
  ) {
    this.searchTerm$
      .pipe(debounceTime(300), distinctUntilChanged())
      .subscribe((searchTerm) => {
        if (searchTerm.startsWith(this.mentionTriggerChar)) {
          void this.updateMentionOptions(searchTerm);
        }
      });
    this.subscriptions.push(
      this.channelService.activeChannel$.subscribe((channel) => {
        const commands = channel?.getConfig()?.commands || [];
        this.slashCommandConfig.items = commands.map((c) => ({
          ...c,
          [this.autocompleteKey]: c.name,
          type: 'command',
        }));
        this.mentionedUsers = [];
        this.userMentions.next([...this.mentionedUsers]);
        void this.updateMentionOptions(this.searchTerm$.getValue());
      })
    );
    this.subscriptions.push(
      this.emojiInputService.emojiInput$.subscribe((emoji) => {
        this.messageInput.nativeElement.focus();
        const { selectionStart } = this.messageInput.nativeElement;
        this.messageInput.nativeElement.setRangeText(emoji);
        this.messageInput.nativeElement.selectionStart =
          selectionStart! + emoji.length;
        this.messageInput.nativeElement.selectionEnd =
          selectionStart! + emoji.length;
        this.inputChanged();
      })
    );
    this.autocompleteConfig.mentions = [
      this.userMentionConfig,
      this.slashCommandConfig,
    ];
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes.areMentionsEnabled) {
      if (this.areMentionsEnabled) {
        this.autocompleteConfig.mentions = [
          this.userMentionConfig,
          this.slashCommandConfig,
        ];
        this.autocompleteConfig = { ...this.autocompleteConfig };
      } else {
        this.autocompleteConfig.mentions = [this.slashCommandConfig];
        this.autocompleteConfig = { ...this.autocompleteConfig };
      }
    }
    if (changes.mentionScope) {
      void this.updateMentionOptions(this.searchTerm$.getValue());
    }
  }

  filter(searchString: string, items: { autocompleteLabel: string }[]) {
    return items.filter((item) =>
      this.transliterate(item.autocompleteLabel.toLowerCase()).includes(
        this.transliterate(searchString.toLowerCase())
      )
    );
  }

  itemSelectedFromAutocompleteList(
    item: MentionAutcompleteListItem,
    triggerChar = ''
  ) {
    if (triggerChar === this.mentionTriggerChar) {
      this.mentionedUsers.push((item.user ? item.user : item) as UserResponse);
      this.userMentions.next([...this.mentionedUsers]);
    }
    return (
      triggerChar +
      item.autocompleteLabel +
      (triggerChar === this.commandTriggerChar ? ' ' : '')
    );
  }

  autcompleteSearchTermChanged(searchTerm: string) {
    if (searchTerm === this.mentionTriggerChar) {
      void this.updateMentionOptions();
    } else {
      this.searchTerm$.next(searchTerm);
    }
  }

  inputChanged() {
    this.valueChange.emit(this.messageInput.nativeElement.value);
  }

  inputLeft() {
    this.updateMentionedUsersFromText();
  }

  sent(event: Event) {
    event.preventDefault();
    this.updateMentionedUsersFromText();
    this.send.next();
  }

  private transliterate(s: string) {
    if (this.transliterationService) {
      return this.transliterationService.transliterate(s);
    } else {
      return s;
    }
  }

  private async updateMentionOptions(searchTerm?: string) {
    if (!this.areMentionsEnabled) {
      return;
    }
    searchTerm = searchTerm?.replace(this.mentionTriggerChar, '');
    const request =
      this.mentionScope === 'application'
        ? (s: string) => this.chatClientService.autocompleteUsers(s)
        : (s: string) => this.channelService.autocompleteMembers(s);
    const result = await request(searchTerm || '');
    const items = this.filter(
      searchTerm || '',
      result.map((i) => {
        const user = (i.user ? i.user : i) as UserResponse;
        return {
          ...i,
          autocompleteLabel: user.name || user.id,
          type: 'mention',
        };
      })
    );
    this.userMentionConfig.items = items;
    this.autocompleteConfig.mentions = [
      this.userMentionConfig,
      this.slashCommandConfig,
    ];
    this.autocompleteConfig = { ...this.autocompleteConfig };
  }

  private updateMentionedUsersFromText() {
    const updatedMentionedUsers: UserResponse[] = [];
    this.mentionedUsers.forEach((u) => {
      const key = u.name || u.id;
      if (this.value.includes(`${this.mentionTriggerChar}${key}`)) {
        updatedMentionedUsers.push(u);
      }
    });
    if (updatedMentionedUsers.length !== this.mentionedUsers.length) {
      this.userMentions.next([...updatedMentionedUsers]);
      this.mentionedUsers = updatedMentionedUsers;
    }
  }
}
