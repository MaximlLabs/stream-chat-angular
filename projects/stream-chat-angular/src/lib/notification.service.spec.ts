import { fakeAsync, TestBed, tick } from '@angular/core/testing';

import { NotificationService } from './notification.service';

describe('NotificationService', () => {
  let service: NotificationService;
  let spy: jasmine.Spy;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(NotificationService);
    spy = jasmine.createSpy();
    service.notifications$.subscribe(spy);
  });

  it('should add temporary notification', () => {
    const text = 'Connection lost';
    const type = 'error';
    service.addTemporaryNotification(text, type);

    expect(spy).toHaveBeenCalledWith([{ text, type }]);
  });

  it('should remove notification, after given time ends', fakeAsync(() => {
    const text = 'Connection lost';
    const type = 'error';
    service.addTemporaryNotification(text, type);

    expect(spy).toHaveBeenCalledWith([{ text, type }]);

    tick(5000);

    expect(spy).toHaveBeenCalledWith([]);
  }));

  it('should add permanent notification', fakeAsync(() => {
    const text = 'Connection lost';
    const type = 'error';
    service.addPermanentNotification(text, type);

    expect(spy).toHaveBeenCalledWith([{ text, type }]);
    spy.calls.reset();

    tick(5000);

    expect(spy).not.toHaveBeenCalled();
  }));

  it('should remove notification', () => {
    const text = 'Connection lost';
    const type = 'error';
    const remove = service.addPermanentNotification(text, type);
    remove();

    expect(spy).toHaveBeenCalledWith([]);
  });
});
