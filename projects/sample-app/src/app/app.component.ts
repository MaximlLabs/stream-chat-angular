import { Component } from '@angular/core';
import {
  ChatClientService,
  ChannelService,
  StreamI18nService,
} from 'stream-chat-angular';
import { environment } from '../environments/environment';
import { TokenProvider } from 'stream-chat';

@Component({
  selector: 'app-root',
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.scss'],
})
export class AppComponent {
  apiKey: string;
  userId: string;
  userName: string;
  channelId: string;

  channelType: string = 'job';

  constructor(
    private chatService: ChatClientService,
    private channelService: ChannelService,
    private streamI18nService: StreamI18nService
  ) {
    const params: any = new Proxy(new URLSearchParams(window.location.search), {
      get: (searchParams, prop) => searchParams.get(<string>prop),
    });

    this.apiKey = params.apikey;
    this.userId = params.userid;
    this.userName = params.username;
    this.channelId = params.channelid;

    console.log(
      'Params',
      this.apiKey,
      this.userId,
      this.userName,
      this.channelId
    );

    console.log(this.chatService.chatClient);

    const devTokenProvider: TokenProvider = () =>
      new Promise((resolve, reject) => {
        let devToken = this.chatService.chatClient.devToken(this.userId);
        //console.log("DevToken", this.userId, devToken)
        resolve(devToken);
      });

    void this.chatService.init(
      this.apiKey,
      { id: this.userId, name: this.userName },
      devTokenProvider
    );

    this.streamI18nService.setTranslation();
  }

  async ngOnInit() {
    const channel = this.chatService.chatClient.channel(
      this.channelType,
      this.channelId
    );
    await channel.create();
    this.channelService.init({
      type: this.channelType,
      id: { $eq: this.channelId },
    });

    // this.channelService.setAsActiveChannel(channel);
  }
}
