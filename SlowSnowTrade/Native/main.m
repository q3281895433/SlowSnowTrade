#import <Cocoa/Cocoa.h>
#import <WebKit/WebKit.h>
#import <Security/Security.h>
#import <CoreFoundation/CoreFoundation.h>

static BOOL SSTPinApplication(NSString *path) {
    id saved=CFBridgingRelease(CFPreferencesCopyAppValue(CFSTR("persistent-apps"),CFSTR("com.apple.dock")));
    if (![saved isKindOfClass:NSArray.class]) return NO;
    NSBundle *bundle=[NSBundle bundleWithPath:path];if(!bundle.bundleIdentifier.length)return NO;
    NSMutableArray *tiles=[saved mutableCopy];NSInteger index=NSNotFound;
    for(NSInteger i=tiles.count-1;i>=0;i--) {
        NSDictionary *data=tiles[i][@"tile-data"];
        if([data[@"bundle-identifier"] isEqual:bundle.bundleIdentifier]||[data[@"file-label"] isEqual:@"SlowSnowTrade"]||[data[@"file-label"] isEqual:@"PaperTrade"]) {
            index=i;[tiles removeObjectAtIndex:i];
        }
    }
    NSDictionary *tile=@{@"GUID":@(arc4random()),@"tile-type":@"file-tile",@"tile-data":@{@"bundle-identifier":bundle.bundleIdentifier,@"file-label":@"SlowSnowTrade",@"file-type":@41,@"file-data":@{@"_CFURLString":[NSURL fileURLWithPath:path isDirectory:YES].absoluteString,@"_CFURLStringType":@15}}};
    [tiles insertObject:tile atIndex:index==NSNotFound?tiles.count:MIN(index,tiles.count)];
    CFPreferencesSetAppValue(CFSTR("persistent-apps"),(__bridge CFArrayRef)tiles,CFSTR("com.apple.dock"));
    return CFPreferencesAppSynchronize(CFSTR("com.apple.dock"));
}

static void SSTReloadDock(void) {
    NSTask *task=[NSTask new];task.executableURL=[NSURL fileURLWithPath:@"/usr/bin/killall"];task.arguments=@[@"-u",NSUserName(),@"Dock"];
    [task launchAndReturnError:nil];
}

static BOOL SSTInstallFromImage(void) {
    NSString *source=NSBundle.mainBundle.bundlePath;
    if(![source hasPrefix:@"/Volumes/"]&&![source containsString:@"/AppTranslocation/"])return NO;
    NSFileManager *files=NSFileManager.defaultManager;
    NSString *folder=[files isWritableFileAtPath:@"/Applications"]?@"/Applications":[NSHomeDirectory() stringByAppendingPathComponent:@"Applications"];
    NSString *target=[folder stringByAppendingPathComponent:@"SlowSnowTrade.app"];
    NSAlert *alert=[NSAlert new];alert.messageText=@"安装小雪交易";
    alert.informativeText=@"当前 App 位于临时磁盘映像。安装到应用程序并固定程序坞后，退出和弹出 DMG 都不会丢失入口。";
    [alert addButtonWithTitle:@"安装并打开"];[alert addButtonWithTitle:@"暂时运行"];
    if([alert runModal]!=NSAlertFirstButtonReturn)return NO;
    NSError *error=nil;[files createDirectoryAtPath:folder withIntermediateDirectories:YES attributes:nil error:&error];
    NSString *stage=[folder stringByAppendingPathComponent:[NSString stringWithFormat:@".SlowSnowTrade-install-%@.app",NSUUID.UUID.UUIDString]];
    if(error||![files copyItemAtPath:source toPath:stage error:&error]) {alert.messageText=@"安装失败";alert.informativeText=error.localizedDescription;[alert runModal];return NO;}
    NSURL *targetURL=[NSURL fileURLWithPath:target];
    if([files fileExistsAtPath:target]) {
        if(![[NSBundle bundleWithPath:target].bundleIdentifier isEqual:NSBundle.mainBundle.bundleIdentifier]) {
            [files removeItemAtPath:stage error:nil];return NO;
        }
        [files replaceItemAtURL:targetURL withItemAtURL:[NSURL fileURLWithPath:stage] backupItemName:nil options:0 resultingItemURL:nil error:&error];
    } else [files moveItemAtPath:stage toPath:target error:&error];
    if(error) { [files removeItemAtPath:stage error:nil];alert.messageText=@"安装失败";alert.informativeText=error.localizedDescription;[alert runModal];return NO; }
    if(SSTPinApplication(target))SSTReloadDock();
    [NSUserDefaults.standardUserDefaults setObject:target forKey:@"SSTDockPath"];
    NSWorkspaceOpenConfiguration *configuration=[NSWorkspaceOpenConfiguration configuration];configuration.createsNewApplicationInstance=YES;
    [NSWorkspace.sharedWorkspace openApplicationAtURL:targetURL configuration:configuration completionHandler:^(NSRunningApplication *app,NSError *launchError){
        dispatch_async(dispatch_get_main_queue(),^{
            if(app&&!launchError)[NSApp terminate:nil];
            else {NSAlert *failure=[NSAlert new];failure.messageText=@"已安装，请从应用程序打开小雪交易";failure.informativeText=launchError.localizedDescription?:@"";[failure runModal];}
        });
    }];
    return YES;
}

@interface SSTAgentStream : NSObject <NSURLSessionDataDelegate>
@property(nonatomic,strong) NSURLSession *session;
@property(nonatomic,strong) NSURLSessionDataTask *task;
@property(nonatomic,strong) NSMutableData *buffer;
@property(nonatomic,strong) NSMutableArray *eventLines;
@property(nonatomic,copy) void (^onDelta)(NSDictionary *);
@property(nonatomic,copy) void (^onEnd)(NSError *);
@property(nonatomic,strong) NSError *streamError;
@property(nonatomic,assign) BOOL done;
- (void)start:(NSURLRequest *)request;
- (void)cancel;
@end
@implementation SSTAgentStream
- (void)start:(NSURLRequest *)request {
    self.buffer=[NSMutableData data];self.eventLines=[NSMutableArray array];
    NSURLSessionConfiguration *config=NSURLSessionConfiguration.defaultSessionConfiguration;
    config.timeoutIntervalForRequest=600;config.timeoutIntervalForResource=900;
    self.session=[NSURLSession sessionWithConfiguration:config delegate:self delegateQueue:NSOperationQueue.mainQueue];
    self.task=[self.session dataTaskWithRequest:request];[self.task resume];
}
- (void)cancel { [self.task cancel]; }
- (void)URLSession:(NSURLSession *)session dataTask:(NSURLSessionDataTask *)task didReceiveResponse:(NSURLResponse *)response completionHandler:(void (^)(NSURLSessionResponseDisposition))completionHandler {
    NSInteger code=[(NSHTTPURLResponse *)response statusCode];
    if(code!=200){self.streamError=[NSError errorWithDomain:@"SSTAgent" code:code userInfo:@{NSLocalizedDescriptionKey:[NSString stringWithFormat:@"DeepSeek HTTP %ld，请检查 Key、余额或模型权限",(long)code]}];completionHandler(NSURLSessionResponseCancel);}
    else completionHandler(NSURLSessionResponseAllow);
}
- (void)consumeEvent {
    if(!self.eventLines.count)return;NSString *text=[self.eventLines componentsJoinedByString:@"\n"];[self.eventLines removeAllObjects];
    if([text isEqual:@"[DONE]"]){self.done=YES;return;}
    id object=[NSJSONSerialization JSONObjectWithData:[text dataUsingEncoding:NSUTF8StringEncoding] options:0 error:nil];
    if(![object isKindOfClass:NSDictionary.class]||object[@"error"]){self.streamError=[NSError errorWithDomain:@"SSTAgent" code:2 userInfo:@{NSLocalizedDescriptionKey:@"DeepSeek 流式响应格式错误"}];[self cancel];return;}
    if(self.onDelta)self.onDelta(object);
}
- (void)URLSession:(NSURLSession *)session dataTask:(NSURLSessionDataTask *)task didReceiveData:(NSData *)data {
    [self.buffer appendData:data];NSData *newline=[@"\n" dataUsingEncoding:NSUTF8StringEncoding];
    while(YES){NSRange range=[self.buffer rangeOfData:newline options:0 range:NSMakeRange(0,self.buffer.length)];if(range.location==NSNotFound)break;
        NSData *row=[self.buffer subdataWithRange:NSMakeRange(0,range.location)];[self.buffer replaceBytesInRange:NSMakeRange(0,range.location+1) withBytes:NULL length:0];
        NSString *line=[[NSString alloc] initWithData:row encoding:NSUTF8StringEncoding];if([line hasSuffix:@"\r"])line=[line substringToIndex:line.length-1];
        if(!line.length)[self consumeEvent];else if([line hasPrefix:@"data:"])[self.eventLines addObject:[[line substringFromIndex:5] stringByTrimmingCharactersInSet:NSCharacterSet.whitespaceCharacterSet]];
    }
    if(self.buffer.length>8*1024*1024){self.streamError=[NSError errorWithDomain:@"SSTAgent" code:3 userInfo:@{NSLocalizedDescriptionKey:@"流式事件过大"}];[self cancel];}
}
- (void)URLSession:(NSURLSession *)session task:(NSURLSessionTask *)task didCompleteWithError:(NSError *)error {
    if(self.buffer.length){NSString *line=[[NSString alloc] initWithData:self.buffer encoding:NSUTF8StringEncoding];if([line hasPrefix:@"data:"])[self.eventLines addObject:[[line substringFromIndex:5] stringByTrimmingCharactersInSet:NSCharacterSet.whitespaceAndNewlineCharacterSet]];}
    [self consumeEvent];NSError *failure=self.streamError?:error;
    if(!failure&&!self.done)failure=[NSError errorWithDomain:@"SSTAgent" code:4 userInfo:@{NSLocalizedDescriptionKey:@"流式连接提前结束；未完成的工具指令不会执行"}];
    void (^end)(NSError *)=self.onEnd;self.onEnd=nil;self.onDelta=nil;[self.session finishTasksAndInvalidate];self.session=nil;self.task=nil;
    if(end)end(failure);
}
@end

@interface PaperTradeDelegate : NSObject <NSApplicationDelegate, WKScriptMessageHandler, WKNavigationDelegate>
@property(nonatomic, strong) NSWindow *window;
@property(nonatomic, strong) WKWebView *webView;
@property(nonatomic, strong) NSURLSession *session;
@property(nonatomic, strong) NSURLSessionWebSocketTask *stream;
@property(nonatomic, assign) NSInteger streamGeneration;
@property(nonatomic, strong) NSMutableDictionary *contractConfigs;
@property(nonatomic, strong) NSMutableDictionary *contractTiers;
@property(nonatomic, strong) NSMutableDictionary *tierFetchedAt;
@property(nonatomic, strong) NSMutableSet *pendingTiers;
@property(nonatomic, strong) NSDate *contractsFetchedAt;
@property(nonatomic, assign) BOOL contractsBusy;
@property(nonatomic, assign) BOOL riskPricesBusy;
@property(nonatomic, strong) NSArray *riskSymbols;
@property(nonatomic, strong) NSTimer *riskTimer;
@property(nonatomic, strong) NSURLSessionWebSocketTask *riskStream;
@property(nonatomic, assign) NSInteger riskGeneration;
@property(nonatomic, strong) NSArray *riskSubscriptions;
@property(nonatomic, strong) NSDate *riskActivity;
@property(nonatomic, assign) BOOL riskReconnecting;
@property(nonatomic, strong) NSMutableDictionary *sentRiskRules;
@property(nonatomic, assign) BOOL logExportPending;
@property(nonatomic, assign) BOOL chatBusy;
@property(nonatomic,strong) SSTAgentStream *chatStream;
@property(nonatomic,copy) NSString *chatID;
@property(nonatomic,strong) NSMutableDictionary *analysisStreams;
@end

@implementation PaperTradeDelegate
- (void)applicationDidFinishLaunching:(NSNotification *)notification {
    (void)notification;
    if(SSTInstallFromImage())return;
    NSString *bundlePath=NSBundle.mainBundle.bundlePath;
    if(([bundlePath hasPrefix:@"/Applications/"]||[bundlePath hasPrefix:[NSHomeDirectory() stringByAppendingPathComponent:@"Applications/"]])&&![[NSUserDefaults.standardUserDefaults stringForKey:@"SSTDockPath"] isEqual:bundlePath]) {
        if(SSTPinApplication(bundlePath)){[NSUserDefaults.standardUserDefaults setObject:bundlePath forKey:@"SSTDockPath"];SSTReloadDock();}
    }
    NSString *iconPath = [[[NSBundle mainBundle] resourcePath] stringByAppendingPathComponent:@"AppIcon.icns"];
    NSImage *icon = [[NSImage alloc] initWithContentsOfFile:iconPath];
    if (icon) NSApp.applicationIconImage = icon;
    NSMenu *mainMenu = [NSMenu new];
    NSMenuItem *applicationItem = [NSMenuItem new]; [mainMenu addItem:applicationItem];
    NSMenu *applicationMenu = [NSMenu new];
    [applicationMenu addItemWithTitle:@"关于小雪交易" action:@selector(orderFrontStandardAboutPanel:) keyEquivalent:@""];
    NSMenuItem *pin=[applicationMenu addItemWithTitle:@"固定到程序坞" action:@selector(pinToDock:) keyEquivalent:@""];pin.target=self;
    [applicationMenu addItem:NSMenuItem.separatorItem];
    [applicationMenu addItemWithTitle:@"隐藏小雪交易" action:@selector(hide:) keyEquivalent:@"h"];
    [applicationMenu addItemWithTitle:@"退出小雪交易" action:@selector(terminate:) keyEquivalent:@"q"];
    applicationItem.submenu = applicationMenu;
    NSMenuItem *editItem = [NSMenuItem new]; editItem.title = @"编辑"; [mainMenu addItem:editItem];
    NSMenu *editMenu = [NSMenu new];
    [editMenu addItemWithTitle:@"剪切" action:@selector(cut:) keyEquivalent:@"x"];
    [editMenu addItemWithTitle:@"复制" action:@selector(copy:) keyEquivalent:@"c"];
    [editMenu addItemWithTitle:@"粘贴" action:@selector(paste:) keyEquivalent:@"v"];
    [editMenu addItemWithTitle:@"全选" action:@selector(selectAll:) keyEquivalent:@"a"];
    editItem.submenu = editMenu; NSApp.mainMenu = mainMenu;
    self.session = [NSURLSession sessionWithConfiguration:[NSURLSessionConfiguration defaultSessionConfiguration]];
    self.contractConfigs = [NSMutableDictionary dictionary];
    self.contractTiers = [NSMutableDictionary dictionary];
    self.tierFetchedAt = [NSMutableDictionary dictionary];
    self.pendingTiers = [NSMutableSet set];
    self.sentRiskRules = [NSMutableDictionary dictionary];
    self.riskTimer = [NSTimer scheduledTimerWithTimeInterval:1 repeats:YES block:^(NSTimer *timer) {
        (void)timer;
        if (self.riskSymbols.count) [self fetchContractRisk:@{ @"symbols": self.riskSymbols }];
    }];
    NSRect frame = NSMakeRect(0, 0, 1480, 900);
    self.window = [[NSWindow alloc] initWithContentRect:frame
        styleMask:(NSWindowStyleMaskTitled | NSWindowStyleMaskClosable |
                  NSWindowStyleMaskMiniaturizable | NSWindowStyleMaskResizable)
        backing:NSBackingStoreBuffered defer:NO];
    self.window.title = @"SlowSnowTrade";
    self.window.minSize = NSMakeSize(980, 650);
    [self.window center];

    WKWebViewConfiguration *configuration = [[WKWebViewConfiguration alloc] init];
    [configuration.userContentController addScriptMessageHandler:self name:@"native"];
    self.webView = [[WKWebView alloc] initWithFrame:frame configuration:configuration];
    self.webView.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
    self.webView.navigationDelegate = self;
    self.window.contentView = self.webView;

    NSString *htmlPath = [[[NSBundle mainBundle] resourcePath] stringByAppendingPathComponent:@"index.html"];
    NSURL *htmlURL = [NSURL fileURLWithPath:htmlPath];
    [self.webView loadFileURL:htmlURL allowingReadAccessToURL:[htmlURL URLByDeletingLastPathComponent]];
    [self.window makeKeyAndOrderFront:nil];
    [NSApp activateIgnoringOtherApps:YES];
}

- (BOOL)applicationShouldTerminateAfterLastWindowClosed:(NSApplication *)sender {
    (void)sender;
    return YES;
}

- (void)pinToDock:(id)sender {
    (void)sender;
    if([NSBundle.mainBundle.bundlePath hasPrefix:@"/Volumes/"]||[NSBundle.mainBundle.bundlePath containsString:@"/AppTranslocation/"]){SSTInstallFromImage();return;}
    if(SSTPinApplication(NSBundle.mainBundle.bundlePath))SSTReloadDock();
}

- (BOOL)applicationShouldHandleReopen:(NSApplication *)sender hasVisibleWindows:(BOOL)visible {
    (void)sender; (void)visible;
    [self.window makeKeyAndOrderFront:nil];
    [NSApp activateIgnoringOtherApps:YES];
    return YES;
}

- (void)applicationWillTerminate:(NSNotification *)notification { (void)notification; [self.riskTimer invalidate]; [self stopStream]; [self stopRiskStream];[self.chatStream cancel];for(SSTAgentStream *stream in self.analysisStreams.allValues)[stream cancel]; }

- (void)webView:(WKWebView *)webView decidePolicyForNavigationAction:(WKNavigationAction *)action decisionHandler:(void (^)(WKNavigationActionPolicy))decisionHandler {
    (void)webView;
    decisionHandler(action.request.URL.isFileURL ? WKNavigationActionPolicyAllow : WKNavigationActionPolicyCancel);
}

- (void)emit:(NSString *)type data:(id)data {
    NSDictionary *event = @{ @"type": type ?: @"error", @"data": data ?: [NSNull null] };
    NSData *json = [NSJSONSerialization dataWithJSONObject:event options:NSJSONWritingFragmentsAllowed error:nil];
    if (!json) return;
    NSString *source = [NSString stringWithFormat:@"window.PaperTradeNative && window.PaperTradeNative(%@)", [[NSString alloc] initWithData:json encoding:NSUTF8StringEncoding]];
    dispatch_async(dispatch_get_main_queue(), ^{ [self.webView evaluateJavaScript:source completionHandler:nil]; });
}

- (NSString *)dataDirectory {
    NSString *desktop = [NSSearchPathForDirectoriesInDomains(NSDesktopDirectory, NSUserDomainMask, YES) firstObject];
    NSString *root = [desktop stringByAppendingPathComponent:@"deepseek"];
    NSString *directory = [root stringByAppendingPathComponent:@"SlowSnowTrade"];
    NSFileManager *files = [NSFileManager defaultManager];
    if (![files fileExistsAtPath:directory]) {
        [files createDirectoryAtPath:directory withIntermediateDirectories:YES attributes:nil error:nil];
        NSString *legacy = [root stringByAppendingPathComponent:@"PaperTrade"];
        for (NSString *name in [files contentsOfDirectoryAtPath:legacy error:nil] ?: @[]) {
            [files copyItemAtPath:[legacy stringByAppendingPathComponent:name]
                      toPath:[directory stringByAppendingPathComponent:name] error:nil];
        }
    }
    return directory;
}

- (BOOL)writeJSON:(id)object name:(NSString *)name error:(NSError **)error {
    if (![NSJSONSerialization isValidJSONObject:object]) return NO;
    NSData *data = [NSJSONSerialization dataWithJSONObject:object options:NSJSONWritingPrettyPrinted | NSJSONWritingSortedKeys error:error];
    if (!data) return NO;
    BOOL ok; @synchronized(self) { ok = [data writeToFile:[[self dataDirectory] stringByAppendingPathComponent:name] options:NSDataWritingAtomic error:error]; }
    if (ok && ([name isEqual:@"state.json"] || [name hasPrefix:@"analysis-"])) [self scheduleLogExport];
    return ok;
}

- (void)appendRecord:(NSDictionary *)record {
    if (![NSJSONSerialization isValidJSONObject:record]) return;
    NSData *data = [NSJSONSerialization dataWithJSONObject:record options:0 error:nil];
    if (!data) return;
    @synchronized(self) {
    NSString *path = [[self dataDirectory] stringByAppendingPathComponent:@"training-data.jsonl"];
    if (![[NSFileManager defaultManager] fileExistsAtPath:path]) [[NSFileManager defaultManager] createFileAtPath:path contents:nil attributes:nil];
    NSFileHandle *file = [NSFileHandle fileHandleForWritingAtPath:path];
    [file seekToEndOfFile]; [file writeData:data]; [file writeData:[@"\n" dataUsingEncoding:NSUTF8StringEncoding]]; [file closeFile];
    }
    [self scheduleLogExport];
}

- (NSString *)tradeLogDirectory {
    NSString *desktop = NSSearchPathForDirectoriesInDomains(NSDesktopDirectory, NSUserDomainMask, YES).firstObject;
    NSString *path = [desktop stringByAppendingPathComponent:@"VScode/SlowSnowTrade/tradelog"];
    [[NSFileManager defaultManager] createDirectoryAtPath:path withIntermediateDirectories:YES attributes:nil error:nil];
    return path;
}
- (NSDictionary *)savedAnalyses {
    NSMutableDictionary *analyses = [NSMutableDictionary dictionary];
    NSString *root = [self dataDirectory];
    for (NSString *name in [[NSFileManager defaultManager] contentsOfDirectoryAtPath:root error:nil] ?: @[]) {
        if (![name hasPrefix:@"analysis-"] || ![name.pathExtension isEqual:@"json"]) continue;
        NSData *data = [NSData dataWithContentsOfFile:[root stringByAppendingPathComponent:name]];
        id record = data ? [NSJSONSerialization JSONObjectWithData:data options:0 error:nil] : nil;
        if ([record isKindOfClass:NSDictionary.class] && [record[@"id"] isKindOfClass:NSString.class] && [record[@"analysis"] isKindOfClass:NSString.class]) analyses[record[@"id"]] = record;
    }
    return analyses;
}
- (void)scheduleLogExport {
    dispatch_async(dispatch_get_main_queue(), ^{
        if (self.logExportPending) return;
        self.logExportPending = YES;
        dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(0.5*NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
            self.logExportPending = NO;
            dispatch_async(dispatch_get_global_queue(QOS_CLASS_UTILITY, 0), ^{ [self exportTradeLog]; });
        });
    });
}
- (void)exportTradeLog {
    @synchronized(self) {
        NSString *root = [self dataDirectory], *target = [self tradeLogDirectory];
        NSData *stateData = [NSData dataWithContentsOfFile:[root stringByAppendingPathComponent:@"state.json"]];
        NSDictionary *state = stateData ? [NSJSONSerialization JSONObjectWithData:stateData options:0 error:nil] : @{};
        NSDictionary *analyses = [self savedAnalyses];
        NSArray *history = [state[@"account"][@"history"] isKindOfClass:NSArray.class] ? state[@"account"][@"history"] : @[];
        NSMutableString *text = [NSMutableString stringWithString:@"# 小雪交易 · Trade Log\n\n本目录同步保存已平仓交易和 DeepSeek 复盘，使用 VS Code 打开即可阅读。\n\n- tradelog.md：可阅读的逐单复盘\n- trades.json：完整历史账单\n- analysis-*.json：DeepSeek 原始复盘\n- training-data.jsonl：训练事件\n\n"];
        [text appendFormat:@"更新：%@\n\n", [NSDate date]];
        if (!history.count && !analyses.count) [text appendString:@"暂无已平仓账单或复盘。平仓后在 App 历史交易中点击“分析”，或开启自动复盘。\n"];
        NSMutableSet *included = [NSMutableSet set];
        for (NSDictionary *trade in history) {
            NSString *identifier = trade[@"id"] ?: @"", *side = [trade[@"side"] isEqual:@"long"] ? @"做多" : @"做空";
            [included addObject:identifier];
            [text appendFormat:@"## %@ · %@ · %@\n\n- 账单：%@\n- 数量：%@\n- 开仓 / 平仓：%@ / %@\n- 保证金：%@ USDT · 杠杆：%@×\n- 净盈亏：%@ USDT · 原因：%@\n\n### DeepSeek 复盘\n\n%@\n\n---\n\n", trade[@"symbol"] ?: @"", side, [NSDate dateWithTimeIntervalSince1970:[trade[@"closedAt"] doubleValue]/1000], identifier, trade[@"qty"] ?: @0, trade[@"entry"] ?: @0, trade[@"exit"] ?: @0, trade[@"margin"] ?: @0, trade[@"leverage"] ?: @0, trade[@"netPnL"] ?: @0, trade[@"reason"] ?: @"", analyses[identifier][@"analysis"] ?: @"尚未生成复盘。可在 App 的历史交易中点击分析。"];
        }
        for (NSString *identifier in analyses) {
            if ([included containsObject:identifier]) continue;
            [text appendFormat:@"## 历史复盘 · %@\n\n%@\n\n---\n\n", identifier, analyses[identifier][@"analysis"]];
        }
        NSError *error = nil;
        if (![text writeToFile:[target stringByAppendingPathComponent:@"tradelog.md"] atomically:YES encoding:NSUTF8StringEncoding error:&error]) {
            [self emit:@"storageError" data:@{ @"message": [@"tradelog 同步失败：" stringByAppendingString:error.localizedDescription ?: @"请检查桌面目录权限"] }]; return;
        }
        NSString *archiveSource = [root stringByAppendingPathComponent:@"analysis-history"], *archiveTarget = [target stringByAppendingPathComponent:@"analysis-history"];
        if ([[NSFileManager defaultManager] fileExistsAtPath:archiveSource]) {
            [[NSFileManager defaultManager] createDirectoryAtPath:archiveTarget withIntermediateDirectories:YES attributes:nil error:nil];
            for (NSString *name in [[NSFileManager defaultManager] contentsOfDirectoryAtPath:archiveSource error:nil] ?: @[]) {
                if (![name.pathExtension isEqual:@"json"]) continue;
                NSData *archived = [NSData dataWithContentsOfFile:[archiveSource stringByAppendingPathComponent:name]];
                [archived writeToFile:[archiveTarget stringByAppendingPathComponent:name] options:NSDataWritingAtomic error:nil];
            }
        }
        NSData *trades = [NSJSONSerialization dataWithJSONObject:history options:NSJSONWritingPrettyPrinted|NSJSONWritingSortedKeys error:nil];
        [trades writeToFile:[target stringByAppendingPathComponent:@"trades.json"] options:NSDataWritingAtomic error:nil];
        for (NSString *name in [[NSFileManager defaultManager] contentsOfDirectoryAtPath:root error:nil] ?: @[]) {
            if (([name hasPrefix:@"analysis-"] && [name.pathExtension isEqual:@"json"]) || [name isEqual:@"training-data.jsonl"]) {
                NSData *data = [NSData dataWithContentsOfFile:[root stringByAppendingPathComponent:name]];
                [data writeToFile:[target stringByAppendingPathComponent:name] options:NSDataWritingAtomic error:nil];
            }
        }
    }
}
- (void)fetchSeedTags {
    NSString *cachePath = [[self dataDirectory] stringByAppendingPathComponent:@"seed-tags.json"];
    NSData *cached = [NSData dataWithContentsOfFile:cachePath];
    NSDictionary *cache = cached ? [NSJSONSerialization JSONObjectWithData:cached options:0 error:nil] : nil;
    if ([cache isKindOfClass:NSDictionary.class]) { NSMutableDictionary *payload = [cache mutableCopy]; payload[@"cached"] = @YES; [self emit:@"seedTags" data:payload]; }
    NSURL *url = [NSURL URLWithString:@"https://www.binance.com/bapi/asset/v2/public/asset-service/product/get-products?includeEtf=true"];
    [self requestJSON:url completion:^(id object, NSError *error) {
        NSArray *products = [object isKindOfClass:NSDictionary.class] ? object[@"data"] : nil;
        if (error || ![products isKindOfClass:NSArray.class]) { if (!cache) [self emit:@"seedTagsError" data:@{}]; return; }
        NSMutableDictionary *tags = [NSMutableDictionary dictionary];
        for (NSDictionary *product in products) {
            if (![product isKindOfClass:NSDictionary.class] || ![product[@"q"] isEqual:@"USDT"] || ![self validSymbol:product[@"s"]] || ![product[@"st"] isEqual:@"TRADING"]) continue;
            NSArray *labels = [product[@"tags"] isKindOfClass:NSArray.class] ? product[@"tags"] : @[];
            tags[product[@"s"]] = @{ @"seed": @([labels containsObject:@"Seed"]), @"tags": labels, @"name": [product[@"an"] isKindOfClass:NSString.class] ? product[@"an"] : product[@"b"] ?: @"", @"source": @"Binance" };
        }
        if (!tags.count) { if (!cache) [self emit:@"seedTagsError" data:@{}]; return; }
        NSDictionary *payload = @{ @"tags": tags, @"fetchedAt": @([[NSDate date] timeIntervalSince1970]), @"cached": @NO };
        [self writeJSON:payload name:@"seed-tags.json" error:nil]; [self emit:@"seedTags" data:payload];
    }];
}

- (NSDictionary *)keyQuery { return @{ (__bridge id)kSecClass: (__bridge id)kSecClassGenericPassword,
                                  (__bridge id)kSecAttrService: @"com.local.papertrade.deepseek",
                                  (__bridge id)kSecAttrAccount: @"api-key" }; }
- (NSString *)apiKey {
    NSMutableDictionary *query = [[self keyQuery] mutableCopy];
    query[(__bridge id)kSecReturnData] = @YES;
    query[(__bridge id)kSecMatchLimit] = (__bridge id)kSecMatchLimitOne;
    CFTypeRef result = NULL;
    if (SecItemCopyMatching((__bridge CFDictionaryRef)query, &result) != errSecSuccess) return nil;
    return [[NSString alloc] initWithData:CFBridgingRelease(result) encoding:NSUTF8StringEncoding];
}
- (void)saveKey:(NSString *)key {
    key=[key stringByTrimmingCharactersInSet:NSCharacterSet.whitespaceAndNewlineCharacterSet];
    if (key.length == 0 || key.length > 1024) { [self emit:@"keyStatus" data:@{ @"saved": @NO, @"error":@"请输入有效 API Key" }]; return; }
    NSMutableDictionary *query = [[self keyQuery] mutableCopy];
    NSDictionary *attributes=@{(__bridge id)kSecValueData:[key dataUsingEncoding:NSUTF8StringEncoding]};
    OSStatus status=SecItemUpdate((__bridge CFDictionaryRef)query,(__bridge CFDictionaryRef)attributes);
    if(status==errSecItemNotFound) { [query addEntriesFromDictionary:attributes];status=SecItemAdd((__bridge CFDictionaryRef)query,NULL); }
    [self emit:@"keyStatus" data:@{ @"saved": @(status == errSecSuccess), @"error": status == errSecSuccess ? @"" : @"无法保存至钥匙串" }];
}

- (NSArray *)agentChatRecords {
    NSData *data=[NSData dataWithContentsOfFile:[[self dataDirectory] stringByAppendingPathComponent:@"agent-chat.json"]];
    id saved=data?[NSJSONSerialization JSONObjectWithData:data options:0 error:nil]:nil;
    NSMutableArray *records=[NSMutableArray array];
    if([saved isKindOfClass:NSArray.class])for(id row in saved) {
        if([row isKindOfClass:NSDictionary.class]&&[row[@"question"] isKindOfClass:NSString.class]&&[row[@"answer"] isKindOfClass:NSString.class])[records addObject:row];
    }
    return records.count>200?[records subarrayWithRange:NSMakeRange(records.count-200,200)]:records;
}

- (void)askAgent:(NSDictionary *)message {
    NSString *identifier=[message[@"id"] isKindOfClass:NSString.class]?message[@"id"]:@"";
    NSString *question=[message[@"question"] isKindOfClass:NSString.class]?message[@"question"]:@"";
    NSArray *input=[message[@"messages"] isKindOfClass:NSArray.class]?message[@"messages"]:nil;
    NSArray *tools=[message[@"tools"] isKindOfClass:NSArray.class]?message[@"tools"]:nil;
    NSData *size=input?[NSJSONSerialization dataWithJSONObject:input options:0 error:nil]:nil;
    if(self.chatBusy||!identifier.length||identifier.length>100||!question.length||question.length>2000||!size||size.length>8*1024*1024||!tools||tools.count>12){[self emit:@"agentError" data:@{@"id":identifier,@"round":message[@"round"]?:@0,@"message":@"Agent 请求格式错误、上下文过大或正在忙"}];return;}
    NSString *key=[self apiKey],*prompt=[NSString stringWithContentsOfFile:[NSBundle.mainBundle.resourcePath stringByAppendingPathComponent:@"chat-system-prompt.txt"] encoding:NSUTF8StringEncoding error:nil];
    if(!key.length||!prompt.length){[self emit:@"agentError" data:@{@"id":identifier,@"round":message[@"round"]?:@0,@"message":@"请先保存 API Key，并确认 Agent 配置存在"}];return;}
    NSMutableArray *messages=[NSMutableArray arrayWithObject:@{@"role":@"system",@"content":prompt}];
    for(id item in input)if([item isKindOfClass:NSDictionary.class]&&[@[@"user",@"assistant",@"tool"] containsObject:item[@"role"]])[messages addObject:item];
    NSMutableURLRequest *request=[NSMutableURLRequest requestWithURL:[NSURL URLWithString:@"https://api.deepseek.com/chat/completions"]];request.HTTPMethod=@"POST";request.timeoutInterval=600;
    [request setValue:[@"Bearer " stringByAppendingString:key] forHTTPHeaderField:@"Authorization"];[request setValue:@"application/json" forHTTPHeaderField:@"Content-Type"];
    request.HTTPBody=[NSJSONSerialization dataWithJSONObject:@{@"model":@"deepseek-v4-pro",@"messages":messages,@"tools":tools,@"thinking":@{@"type":@"enabled"},@"reasoning_effort":@"max",@"stream":@YES} options:0 error:nil];
    self.chatBusy=YES;self.chatID=identifier;SSTAgentStream *stream=[SSTAgentStream new];self.chatStream=stream;
    __weak PaperTradeDelegate *owner=self;
    stream.onDelta=^(NSDictionary *chunk){[owner emit:@"agentDelta" data:@{@"id":identifier,@"round":message[@"round"]?:@0,@"chunk":chunk}];};
    stream.onEnd=^(NSError *error){PaperTradeDelegate *strong=owner;strong.chatBusy=NO;strong.chatStream=nil;
        [strong emit:error?@"agentError":@"agentStreamEnd" data:@{@"id":identifier,@"round":message[@"round"]?:@0,@"message":error.localizedDescription?:@""}];};
    [stream start:request];
}
- (void)saveAgentConversation:(NSDictionary *)message {
    NSDictionary *record=[message[@"record"] isKindOfClass:NSDictionary.class]?message[@"record"]:nil;
    NSData *size=record?[NSJSONSerialization dataWithJSONObject:record options:0 error:nil]:nil;
    NSString *identifier=[record[@"id"] isKindOfClass:NSString.class]?record[@"id"]:@"";
    if(!identifier.length||![record[@"question"] isKindOfClass:NSString.class]||![record[@"answer"] isKindOfClass:NSString.class]||!size||size.length>2*1024*1024){[self emit:@"agentSaveError" data:@{@"id":identifier,@"message":@"对话记录格式错误或过大"}];return;}
    NSMutableArray *records=[[self agentChatRecords] mutableCopy];NSIndexSet *old=[records indexesOfObjectsPassingTest:^BOOL(NSDictionary *row,NSUInteger i,BOOL *stop){return[row[@"id"] isEqual:identifier];}];[records removeObjectsAtIndexes:old];[records addObject:record];if(records.count>200)[records removeObjectAtIndex:0];
    NSError *error=nil;if(![self writeJSON:records name:@"agent-chat.json" error:&error]){[self emit:@"agentSaveError" data:@{@"id":identifier,@"message":error.localizedDescription?:@"对话保存失败"}];return;}
    NSMutableString *text=[NSMutableString stringWithString:@"# 小雪 Agent 对话\n\n"];
    for(NSDictionary *item in records){NSData *tools=[NSJSONSerialization dataWithJSONObject:item[@"tools"]?:@[] options:NSJSONWritingPrettyPrinted error:nil];[text appendFormat:@"## %@\n\n### 问题\n\n%@\n\n### 回答\n\n%@\n\n### 工具执行\n\n%@\n\n",[NSDate dateWithTimeIntervalSince1970:([item[@"createdAt"] doubleValue]>1e12?[item[@"createdAt"] doubleValue]/1000:[item[@"createdAt"] doubleValue])],item[@"question"],item[@"answer"],[[NSString alloc] initWithData:tools encoding:NSUTF8StringEncoding]];}
    if(![text writeToFile:[[self tradeLogDirectory] stringByAppendingPathComponent:@"agent-chat.md"] atomically:YES encoding:NSUTF8StringEncoding error:&error]){[self emit:@"agentSaveError" data:@{@"id":identifier,@"message":@"对话已保存，但 tradelog 导出失败"}];return;}
    [self emit:@"agentAnswer" data:record];
}
- (void)agentReadTraining:(NSDictionary *)message {
    NSInteger limit=MAX(1,MIN(30,[message[@"limit"] integerValue]?:8));NSMutableArray *samples=[NSMutableArray array];
    NSFileHandle *file=[NSFileHandle fileHandleForReadingAtPath:[[self dataDirectory] stringByAppendingPathComponent:@"training-data.jsonl"]];
    if(file){unsigned long long length=[file seekToEndOfFile],size=MIN(length,256*1024);[file seekToFileOffset:length-size];NSData *tail=[file readDataOfLength:(NSUInteger)size];[file closeFile];if(length>size){NSRange newline=[tail rangeOfData:[@"\n" dataUsingEncoding:NSUTF8StringEncoding] options:0 range:NSMakeRange(0,tail.length)];tail=newline.location==NSNotFound?[NSData data]:[tail subdataWithRange:NSMakeRange(newline.location+1,tail.length-newline.location-1)];}NSString *text=[[NSString alloc] initWithData:tail encoding:NSUTF8StringEncoding];NSMutableArray *lines=[[text componentsSeparatedByString:@"\n"] mutableCopy]?:[NSMutableArray array];
        for(NSString *line in lines)if(line.length){id row=[NSJSONSerialization JSONObjectWithData:[line dataUsingEncoding:NSUTF8StringEncoding] options:0 error:nil];if([row isKindOfClass:NSDictionary.class])[samples addObject:row];}
    }
    if(samples.count>(NSUInteger)limit)samples=[[samples subarrayWithRange:NSMakeRange(samples.count-limit,limit)] mutableCopy];
    [self emit:@"agentTrainingData" data:@{@"id":message[@"id"]?:@"",@"callId":message[@"callId"]?:@"",@"samples":samples}];
}

- (BOOL)validSymbol:(NSString *)symbol {
    if (![symbol isKindOfClass:NSString.class]) return NO;
    NSRegularExpression *regex = [NSRegularExpression regularExpressionWithPattern:@"^[A-Z0-9]{1,25}USDT$" options:0 error:nil];
    return [regex numberOfMatchesInString:symbol options:0 range:NSMakeRange(0, symbol.length)] == 1;
}
- (BOOL)validInterval:(NSString *)interval { return [@[@"1m", @"3m", @"5m", @"15m", @"30m", @"1h", @"4h", @"6h", @"12h", @"1d", @"2d", @"1w"] containsObject:interval]; }
- (NSString *)marketInterval:(NSString *)interval { return [@[@"2d", @"1w"] containsObject:interval] ? @"1d" : interval; }

- (void)requestJSON:(NSURL *)url completion:(void (^)(id, NSError *))completion {
    NSMutableURLRequest *request = [NSMutableURLRequest requestWithURL:url]; request.timeoutInterval = 12; request.cachePolicy = NSURLRequestReloadIgnoringLocalCacheData;
    [[self.session dataTaskWithRequest:request completionHandler:^(NSData *data, NSURLResponse *response, NSError *error) {
        if (error) { completion(nil, error); return; }
        NSInteger status = [(NSHTTPURLResponse *)response statusCode];
        if (status != 200) { completion(nil, [NSError errorWithDomain:@"PaperTrade.HTTP" code:status userInfo:@{NSLocalizedDescriptionKey:[NSString stringWithFormat:@"HTTP %ld", (long)status]}]); return; }
        id object = [NSJSONSerialization JSONObjectWithData:data options:0 error:&error]; completion(object, error);
    }] resume];
}

- (NSString *)marketSource:(id)value {
    return [value isKindOfClass:NSString.class] && [value isEqual:@"bitget"] ? @"bitget" : @"binance";
}
- (NSString *)bitgetInterval:(NSString *)interval {
    return @{ @"1m": @"1m", @"3m": @"3m", @"5m": @"5m", @"15m": @"15m", @"30m": @"30m", @"1h": @"1H", @"4h": @"4H", @"6h": @"6H", @"12h": @"12H", @"1d": @"1D", @"2d": @"1D", @"1w": @"1D" }[interval] ?: @"15m";
}
- (void)emitContractRules:(NSString *)symbol {
    NSDictionary *config = self.contractConfigs[symbol];
    NSArray *tiers = self.contractTiers[symbol];
    if (!config || !tiers.count) return;
    NSDictionary *rules = @{ @"symbol": symbol, @"source": @"bitget", @"tiers": tiers,
        @"feeRate": config[@"takerFeeRate"] ?: @"0.0006", @"makerFeeRate": config[@"makerFeeRate"] ?: @"0.0002", @"maxLeverage": config[@"maxLever"] ?: @"100",
        @"minQty": config[@"minTradeNum"] ?: @"0", @"qtyStep": config[@"sizeMultiplier"] ?: @"0",
        @"minNotional": config[@"minTradeUSDT"] ?: @"5", @"status": config[@"symbolStatus"] ?: @"normal" };
    if ([self.sentRiskRules[symbol] isEqual:rules]) return;
    self.sentRiskRules[symbol] = rules;
    [self emit:@"contractRules" data:rules];
}
- (void)fetchContractRisk:(NSDictionary *)message {
    NSMutableArray *symbols = [NSMutableArray array];
    for (id symbol in [message[@"symbols"] isKindOfClass:NSArray.class] ? message[@"symbols"] : @[])
        if ([self validSymbol:symbol] && ![symbols containsObject:symbol]) [symbols addObject:symbol];
    if (!symbols.count) return;
    [self startRiskStream:symbols];
    if (!self.contractsBusy && (!self.contractsFetchedAt || -self.contractsFetchedAt.timeIntervalSinceNow > 21600)) {
        self.contractsBusy = YES;
        [self requestJSON:[NSURL URLWithString:@"https://api.bitget.com/api/v2/mix/market/contracts?productType=USDT-FUTURES"] completion:^(id object, NSError *error) {
            dispatch_async(dispatch_get_main_queue(), ^{
                self.contractsBusy = NO;
                NSArray *items = [object isKindOfClass:NSDictionary.class] && [object[@"code"] isEqual:@"00000"] ? object[@"data"] : nil;
                if (!error && [items isKindOfClass:NSArray.class] && items.count) {
                    [self.contractConfigs removeAllObjects];
                    for (NSDictionary *item in items) if ([item isKindOfClass:NSDictionary.class] && [self validSymbol:item[@"symbol"]]) self.contractConfigs[item[@"symbol"]] = item;
                    self.contractsFetchedAt = [NSDate date];
                    for (NSString *symbol in symbols) [self emitContractRules:symbol];
                }
            });
        }];
    }
    NSInteger requestIndex = 0;
    for (NSString *symbol in symbols) {
        [self emitContractRules:symbol];
        NSDate *fetched = self.tierFetchedAt[symbol];
        if ([self.pendingTiers containsObject:symbol] || (fetched && -fetched.timeIntervalSinceNow < 21600)) continue;
        [self.pendingTiers addObject:symbol];
        dispatch_after(dispatch_time(DISPATCH_TIME_NOW, requestIndex++ * 150 * NSEC_PER_MSEC), dispatch_get_main_queue(), ^{
            NSString *url = [NSString stringWithFormat:@"https://api.bitget.com/api/v2/mix/market/query-position-lever?productType=USDT-FUTURES&symbol=%@", symbol];
            [self requestJSON:[NSURL URLWithString:url] completion:^(id object, NSError *error) {
                dispatch_async(dispatch_get_main_queue(), ^{
                    [self.pendingTiers removeObject:symbol];
                    NSArray *tiers = [object isKindOfClass:NSDictionary.class] && [object[@"code"] isEqual:@"00000"] ? object[@"data"] : nil;
                    // Cache a missing contract briefly instead of retrying every price update.
                    self.tierFetchedAt[symbol] = error || ![tiers isKindOfClass:NSArray.class] || !tiers.count ? [NSDate dateWithTimeIntervalSinceNow:-21540] : [NSDate date];
                    if (!error && [tiers isKindOfClass:NSArray.class] && tiers.count) { self.contractTiers[symbol] = tiers; [self emitContractRules:symbol]; }
                });
            }];
        });
    }
    if (self.riskPricesBusy) return;
    self.riskPricesBusy = YES;
    [self requestJSON:[NSURL URLWithString:@"https://api.bitget.com/api/v2/mix/market/tickers?productType=USDT-FUTURES"] completion:^(id object, NSError *error) {
        dispatch_async(dispatch_get_main_queue(), ^{
            self.riskPricesBusy = NO;
            NSArray *items = [object isKindOfClass:NSDictionary.class] && [object[@"code"] isEqual:@"00000"] ? object[@"data"] : nil;
            if (error || ![items isKindOfClass:NSArray.class]) { [self emit:@"contractRiskError" data:@{ @"message": error.localizedDescription ?: @"合约标记价暂不可用" }]; return; }
            NSMutableArray *quotes = [NSMutableArray array];
            for (NSDictionary *item in items) if ([item isKindOfClass:NSDictionary.class] && [symbols containsObject:item[@"symbol"]] && [item[@"markPrice"] doubleValue] > 0) {
                [quotes addObject:@{ @"symbol": item[@"symbol"], @"mark": item[@"markPrice"], @"last": item[@"lastPr"] ?: item[@"markPrice"],
                    @"bid": item[@"bidPr"] ?: @0, @"ask": item[@"askPr"] ?: @0, @"time": item[@"ts"] ?: @0 }];
            }
            [self emit:@"contractRiskSnapshot" data:@{ @"source": @"bitget", @"quotes": quotes, @"requestedSymbols": symbols, @"receivedAt": @([[NSDate date] timeIntervalSince1970] * 1000) }];
        });
    }];
}
- (void)fetchKlines:(NSDictionary *)message {
    NSString *symbol = [message[@"symbol"] isKindOfClass:NSString.class] ? [message[@"symbol"] uppercaseString] : @"";
    NSString *interval = message[@"interval"];
    if (![self validSymbol:symbol] || ![self validInterval:interval]) return;
    NSString *limit = [@[@"2d", @"1w"] containsObject:interval] ? @"1000" : @"500";
    NSString *choice = [message[@"source"] isKindOfClass:NSString.class] ? message[@"source"] : @"auto";
    NSNumber *requestId = [message[@"requestId"] isKindOfClass:NSNumber.class] ? message[@"requestId"] : @0;
    NSArray *sources = [choice isEqual:@"auto"] ? @[@"bitget", @"binance"] : @[[self marketSource:choice]];
    __block BOOL resolved = NO;
    __block NSInteger failures = 0;
    for (NSString *source in sources) {
        NSURLComponents *url;
        if ([source isEqual:@"bitget"]) {
            url = [NSURLComponents componentsWithString:@"https://api.bitget.com/api/v3/market/candles"];
            url.queryItems = @[[NSURLQueryItem queryItemWithName:@"category" value:@"SPOT"], [NSURLQueryItem queryItemWithName:@"symbol" value:symbol], [NSURLQueryItem queryItemWithName:@"interval" value:[self bitgetInterval:interval]], [NSURLQueryItem queryItemWithName:@"limit" value:limit]];
        } else {
            url = [NSURLComponents componentsWithString:@"https://data-api.binance.vision/api/v3/klines"];
            url.queryItems = @[[NSURLQueryItem queryItemWithName:@"symbol" value:symbol], [NSURLQueryItem queryItemWithName:@"interval" value:[self marketInterval:interval]], [NSURLQueryItem queryItemWithName:@"limit" value:limit]];
        }
        [self requestJSON:url.URL completion:^(id object, NSError *error) {
            NSArray *rows = nil;
            if ([source isEqual:@"bitget"] && [object isKindOfClass:NSDictionary.class] && [object[@"code"] isEqual:@"00000"] && [object[@"data"] isKindOfClass:NSArray.class]) rows = object[@"data"];
            if ([source isEqual:@"binance"] && [object isKindOfClass:NSArray.class]) rows = object;
            dispatch_async(dispatch_get_main_queue(), ^{
                if (resolved) return;
                if (!error && rows.count) {
                    resolved = YES;
                    [self emit:@"marketSnapshot" data:@{ @"source": source, @"symbol": symbol, @"interval": interval, @"requestId": requestId, @"rows": rows }];
                } else if (++failures == sources.count) {
                    resolved = YES;
                    [self emit:@"marketError" data:@{ @"message": error.localizedDescription ?: @"行情源未返回 K 线", @"symbol": symbol, @"requestId": requestId }];
                }
            });
        }];
    }
}
- (void)fetchSymbols:(NSDictionary *)message {
    NSString *source = [self marketSource:message[@"source"]];
    NSURL *url = [NSURL URLWithString:[source isEqual:@"bitget"] ? @"https://api.bitget.com/api/v3/market/instruments?category=SPOT" : @"https://data-api.binance.vision/api/v3/exchangeInfo"];
    [self requestJSON:url completion:^(id object, NSError *error) {
        if (error) { [self emit:@"symbolsError" data:@{ @"message": error.localizedDescription }]; return; }
        NSArray *items = [source isEqual:@"bitget"] ? ([object isKindOfClass:NSDictionary.class] ? object[@"data"] : nil) : ([object isKindOfClass:NSDictionary.class] ? object[@"symbols"] : nil);
        NSMutableArray *pairs = [NSMutableArray array];
        for (NSDictionary *item in [items isKindOfClass:NSArray.class] ? items : @[]) {
            if (![item isKindOfClass:NSDictionary.class]) continue;
            NSString *symbol = item[@"symbol"];
            NSString *quote = [source isEqual:@"bitget"] ? item[@"quoteCoin"] : item[@"quoteAsset"];
            NSString *status = item[@"status"];
            BOOL active = [source isEqual:@"bitget"] ? [status isEqual:@"online"] : [status isEqual:@"TRADING"];
            if ([self validSymbol:symbol] && [quote isEqual:@"USDT"] && active)
                [pairs addObject:@{ @"id": symbol, @"base": ([source isEqual:@"bitget"] ? item[@"baseCoin"] : item[@"baseAsset"]) ?: @"" }];
        }
        [self emit:@"symbols" data:@{ @"source": source, @"pairs": pairs }];
        [self fetchTopSymbols:@{ @"source": source, @"onlyQuotes": @YES }];
    }];
}
- (void)fetchTopSymbols:(NSDictionary *)message {
    NSString *source = [self marketSource:message[@"source"]];
    NSURL *url = [NSURL URLWithString:[source isEqual:@"bitget"] ? @"https://api.bitget.com/api/v3/market/tickers?category=SPOT" : @"https://data-api.binance.vision/api/v3/ticker/24hr"];
    [self requestJSON:url completion:^(id object, NSError *error) {
        if (error) { [self emit:@"topSymbolsError" data:@{ @"message": error.localizedDescription }]; return; }
        NSArray *items = [source isEqual:@"bitget"] ? ([object isKindOfClass:NSDictionary.class] ? object[@"data"] : nil) : object;
        NSMutableArray *pairs = [NSMutableArray array];
        for (NSDictionary *item in [items isKindOfClass:NSArray.class] ? items : @[]) if ([item isKindOfClass:NSDictionary.class] && [self validSymbol:item[@"symbol"]]) [pairs addObject:item];
        NSMutableArray *quotes = [NSMutableArray array];
        for (NSDictionary *item in pairs) {
            double price = [item[@"lastPrice"] doubleValue];
            if (!(price > 0)) continue;
            double change = [source isEqual:@"bitget"] ? [item[@"price24hPcnt"] doubleValue]*100 : [item[@"priceChangePercent"] doubleValue];
            [quotes addObject:@{ @"symbol": item[@"symbol"], @"price": @(price), @"change": @(change) }];
        }
        [self emit:@"discoveryQuotes" data:@{ @"source": source, @"quotes": quotes }];
        if ([message[@"onlyQuotes"] boolValue]) return;
        NSString *volumeKey = [source isEqual:@"bitget"] ? @"turnover24h" : @"quoteVolume";
        [pairs sortUsingComparator:^NSComparisonResult(NSDictionary *a, NSDictionary *b) {
            double left = [a[volumeKey] doubleValue], right = [b[volumeKey] doubleValue];
            return left > right ? NSOrderedAscending : (left < right ? NSOrderedDescending : NSOrderedSame);
        }];
        NSMutableArray *result = [NSMutableArray array];
        for (NSDictionary *item in pairs) {
            if (result.count >= 40) break;
            NSString *symbol = item[@"symbol"];
            [result addObject:@{ @"id": symbol, @"base": [symbol substringToIndex:symbol.length - 4] }];
        }
        [self emit:@"topSymbols" data:@{ @"source": source, @"pairs": result }];
    }];
}
- (void)stopRiskStream {
    self.riskGeneration++;
    [self.riskStream cancelWithCloseCode:NSURLSessionWebSocketCloseCodeGoingAway reason:nil];
    self.riskStream=nil;self.riskReconnecting=NO;
}
- (void)startRiskStream:(NSArray *)symbols {
    if ([self.riskSubscriptions isEqualToArray:symbols] && (self.riskReconnecting || (self.riskStream && -self.riskActivity.timeIntervalSinceNow < 60))) return;
    [self stopRiskStream];if(!symbols.count)return;
    self.riskSubscriptions=[symbols copy];self.riskActivity=[NSDate date];
    NSInteger generation=self.riskGeneration;
    self.riskStream=[self.session webSocketTaskWithURL:[NSURL URLWithString:@"wss://ws.bitget.com/v2/ws/public"]];
    [self.riskStream resume];
    NSMutableArray *args=[NSMutableArray array];
    for(NSString *symbol in symbols)[args addObject:@{@"instType":@"USDT-FUTURES",@"channel":@"ticker",@"instId":symbol}];
    NSData *data=[NSJSONSerialization dataWithJSONObject:@{@"op":@"subscribe",@"args":args} options:0 error:nil];
    [self.riskStream sendMessage:[[NSURLSessionWebSocketMessage alloc] initWithString:[[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding]] completionHandler:^(NSError *error) { (void)error; }];
    [self pingRiskStream:generation];[self listenRiskStream:generation];
}
- (void)pingRiskStream:(NSInteger)generation {
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW,25*NSEC_PER_SEC),dispatch_get_main_queue(),^{
        if(generation!=self.riskGeneration||!self.riskStream)return;
        [self.riskStream sendMessage:[[NSURLSessionWebSocketMessage alloc] initWithString:@"ping"] completionHandler:^(NSError *error){(void)error;}];
        [self pingRiskStream:generation];
    });
}
- (void)listenRiskStream:(NSInteger)generation {
    NSURLSessionWebSocketTask *stream=self.riskStream;
    [stream receiveMessageWithCompletionHandler:^(NSURLSessionWebSocketMessage *message,NSError *error){
        dispatch_async(dispatch_get_main_queue(),^{
            if(generation!=self.riskGeneration)return;
            if(error){
                self.riskStream=nil;self.riskReconnecting=YES;
                dispatch_after(dispatch_time(DISPATCH_TIME_NOW,3*NSEC_PER_SEC),dispatch_get_main_queue(),^{
                    if(generation!=self.riskGeneration)return;
                    self.riskReconnecting=NO;[self startRiskStream:self.riskSymbols];
                });return;
            }
            self.riskActivity=[NSDate date];
            NSData *data=message.type==NSURLSessionWebSocketMessageTypeString?[message.string dataUsingEncoding:NSUTF8StringEncoding]:message.data;
            NSDictionary *payload=data?[NSJSONSerialization JSONObjectWithData:data options:0 error:nil]:nil;
            if([payload isKindOfClass:NSDictionary.class]){
                NSDictionary *arg=payload[@"arg"];NSArray *rows=payload[@"data"];
                if([arg isKindOfClass:NSDictionary.class] && [arg[@"channel"] isEqual:@"ticker"] && [self.riskSymbols containsObject:arg[@"instId"]] && [rows isKindOfClass:NSArray.class]){
                    NSMutableArray *quotes=[NSMutableArray array];
                    for(id row in rows)if([row isKindOfClass:NSDictionary.class] && [row[@"markPrice"] doubleValue]>0 && [row[@"lastPr"] doubleValue]>0)
                        [quotes addObject:@{@"symbol":arg[@"instId"],@"mark":row[@"markPrice"],@"last":row[@"lastPr"],@"bid":row[@"bidPr"]?:@0,@"ask":row[@"askPr"]?:@0,@"time":row[@"ts"]?:payload[@"ts"]?:@0}];
                    if(quotes.count)[self emit:@"contractRiskSnapshot" data:@{@"source":@"bitget",@"quotes":quotes}];
                }
            }
            [self listenRiskStream:generation];
        });
    }];
}
- (void)stopStream {
    self.streamGeneration += 1;
    [self.stream cancelWithCloseCode:NSURLSessionWebSocketCloseCodeGoingAway reason:nil];
    self.stream = nil;
}
- (void)startStream:(NSArray *)symbols interval:(NSString *)interval source:(NSString *)source {
    [self stopStream];
    if (![self validInterval:interval] || ![symbols isKindOfClass:NSArray.class]) return;
    source = [self marketSource:source];
    NSMutableArray *valid = [NSMutableArray array];
    for (id symbol in symbols) if ([self validSymbol:symbol] && valid.count < 20 && ![valid containsObject:symbol]) [valid addObject:symbol];
    if (!valid.count) return;
    NSURL *url;
    if ([source isEqual:@"bitget"]) url = [NSURL URLWithString:@"wss://ws.bitget.com/v3/ws/public"];
    else {
        NSMutableArray *names = [NSMutableArray array];
        for (NSString *symbol in valid) [names addObject:[NSString stringWithFormat:@"%@@kline_%@", symbol.lowercaseString, [self marketInterval:interval]]];
        url = [NSURL URLWithString:[NSString stringWithFormat:@"wss://data-stream.binance.vision/stream?streams=%@", [names componentsJoinedByString:@"/"]]];
    }
    self.stream = [self.session webSocketTaskWithURL:url];
    NSInteger generation = self.streamGeneration;
    [self.stream resume];
    if ([source isEqual:@"bitget"]) {
        NSMutableArray *args = [NSMutableArray array];
        for (NSString *symbol in valid) [args addObject:@{ @"instType": @"spot", @"topic": @"kline", @"symbol": symbol, @"interval": [self bitgetInterval:interval] }];
        NSData *data = [NSJSONSerialization dataWithJSONObject:@{ @"op": @"subscribe", @"args": args } options:0 error:nil];
        NSString *subscription = [[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding];
        [self.stream sendMessage:[[NSURLSessionWebSocketMessage alloc] initWithString:subscription] completionHandler:^(NSError *error) {
            if (error && generation == self.streamGeneration) [self emit:@"streamState" data:@{ @"connected": @NO, @"message": error.localizedDescription }];
        }];
        [self pingStream:generation];
    }
    [self listenToStream:generation symbols:[valid copy] interval:interval source:source];
}
- (void)pingStream:(NSInteger)generation {
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 25 * NSEC_PER_SEC), dispatch_get_main_queue(), ^{
        if (generation != self.streamGeneration || !self.stream) return;
        [self.stream sendMessage:[[NSURLSessionWebSocketMessage alloc] initWithString:@"ping"] completionHandler:^(NSError *error) { if (error) [self emit:@"streamState" data:@{ @"connected": @NO, @"message": error.localizedDescription }]; }];
        [self pingStream:generation];
    });
}
- (void)listenToStream:(NSInteger)generation symbols:(NSArray *)symbols interval:(NSString *)interval source:(NSString *)source {
    NSURLSessionWebSocketTask *stream = self.stream;
    [stream receiveMessageWithCompletionHandler:^(NSURLSessionWebSocketMessage *message, NSError *error) {
        if (generation != self.streamGeneration) return;
        if (error) {
            [self emit:@"streamState" data:@{ @"connected": @NO, @"message": error.localizedDescription }];
            dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 3 * NSEC_PER_SEC), dispatch_get_main_queue(), ^{ if (generation == self.streamGeneration) [self startStream:symbols interval:interval source:source]; });
            return;
        }
        NSData *data = message.type == NSURLSessionWebSocketMessageTypeString ? [message.string dataUsingEncoding:NSUTF8StringEncoding] : message.data;
        NSDictionary *payload = data ? [NSJSONSerialization JSONObjectWithData:data options:0 error:nil] : nil;
        NSDictionary *tick = nil;
        if ([source isEqual:@"bitget"]) {
            NSDictionary *arg = [payload isKindOfClass:NSDictionary.class] ? payload[@"arg"] : nil;
            NSArray *rows = [payload isKindOfClass:NSDictionary.class] ? payload[@"data"] : nil;
            NSDictionary *row = [rows isKindOfClass:NSArray.class] && rows.count ? rows[0] : nil;
            if ([arg isKindOfClass:NSDictionary.class] && [row isKindOfClass:NSDictionary.class] && [self validSymbol:arg[@"symbol"]]) {
                tick = @{ @"source": source, @"i": [self marketInterval:interval], @"s": arg[@"symbol"], @"t": row[@"start"] ?: @0, @"o": row[@"open"] ?: @0, @"h": row[@"high"] ?: @0, @"l": row[@"low"] ?: @0, @"c": row[@"close"] ?: @0, @"v": row[@"volume"] ?: @0 };
            }
        } else {
            NSDictionary *event = [payload isKindOfClass:NSDictionary.class] ? (payload[@"data"] ?: payload) : nil;
            NSDictionary *candle = [event[@"k"] isKindOfClass:NSDictionary.class] ? event[@"k"] : nil;
            if (candle) { NSMutableDictionary *normalized = [candle mutableCopy]; normalized[@"source"] = source; tick = normalized; }
        }
        if (tick) {
            [self emit:@"marketTick" data:tick];
            [self emit:@"streamState" data:@{ @"connected": @YES }];
        }
        [self listenToStream:generation symbols:symbols interval:interval source:source];
    }];
}

- (void)fetchAnalysisContext:(NSDictionary *)message {
    NSDictionary *trade = [message[@"trade"] isKindOfClass:NSDictionary.class] ? message[@"trade"] : nil;
    NSString *identifier = message[@"requestId"], *symbol = trade[@"symbol"];
    NSString *interval = [self validInterval:message[@"interval"]] ? message[@"interval"] : @"15m";
    if (![self validSymbol:symbol] || ![identifier isKindOfClass:NSString.class]) return;
    double now = [[NSDate date] timeIntervalSince1970]*1000;
    NSMutableArray *jobs = [NSMutableArray arrayWithArray:@[
        @{ @"purpose": @"entry", @"symbol": symbol, @"interval": interval, @"endTime": trade[@"openedAt"] ?: @(now) },
        @{ @"purpose": @"exit", @"symbol": symbol, @"interval": interval, @"endTime": trade[@"closedAt"] ?: @(now) },
        @{ @"purpose": @"current", @"symbol": symbol, @"interval": interval, @"endTime": @(now) }]];
    for (NSString *period in @[@"1h", @"4h"]) [jobs addObject:@{ @"purpose": [period isEqual:@"1h"] ? @"hourly" : @"fourHourly", @"symbol": symbol, @"interval": period, @"endTime": @(now) }];
    if (![symbol isEqual:@"BTCUSDT"]) [jobs addObject:@{ @"purpose": @"bitcoin", @"symbol": @"BTCUSDT", @"interval": @"1h", @"endTime": @(now) }];
    dispatch_group_t group = dispatch_group_create();
    NSMutableArray *datasets = [NSMutableArray array];
    for (NSDictionary *job in jobs) {
        double end = [job[@"endTime"] doubleValue];
        BOOL old = now-end > 89*86400000.;
        NSURLComponents *url = [NSURLComponents componentsWithString:old ? @"https://api.bitget.com/api/v3/market/history-candles" : @"https://api.bitget.com/api/v3/market/candles"];
        url.queryItems = @[[NSURLQueryItem queryItemWithName:@"category" value:@"USDT-FUTURES"], [NSURLQueryItem queryItemWithName:@"symbol" value:job[@"symbol"]],
            [NSURLQueryItem queryItemWithName:@"interval" value:[self bitgetInterval:job[@"interval"]]], [NSURLQueryItem queryItemWithName:@"endTime" value:[NSString stringWithFormat:@"%.0f", end]],
            [NSURLQueryItem queryItemWithName:@"limit" value:old ? @"100" : ([@[@"2d", @"1w"] containsObject:job[@"interval"]] ? @"1000" : @"200")]];
        dispatch_group_enter(group);
        [self requestJSON:url.URL completion:^(id object, NSError *error) {
            NSArray *rows = [object isKindOfClass:NSDictionary.class] && [object[@"code"] isEqual:@"00000"] && [object[@"data"] isKindOfClass:NSArray.class] ? object[@"data"] : @[];
            NSMutableDictionary *dataset = [job mutableCopy];
            dataset[@"sourceInterval"] = [self marketInterval:job[@"interval"]];
            dataset[@"source"] = @"Bitget"; dataset[@"category"] = @"USDT-FUTURES"; dataset[@"rows"] = rows;
            if (error || !rows.count) dataset[@"error"] = error.localizedDescription ?: @"该时段未返回合约 K 线";
            @synchronized(datasets) { [datasets addObject:dataset]; }
            dispatch_group_leave(group);
        }];
    }
    dispatch_group_notify(group, dispatch_get_main_queue(), ^{
        if ([symbol isEqual:@"BTCUSDT"]) {
            for (NSDictionary *dataset in [datasets copy]) if ([dataset[@"purpose"] isEqual:@"hourly"]) { NSMutableDictionary *btc = [dataset mutableCopy]; btc[@"purpose"] = @"bitcoin"; [datasets addObject:btc]; break; }
        }
        [self emit:@"analysisContext" data:@{ @"requestId": identifier, @"tradeId": trade[@"id"] ?: @"", @"datasets": datasets }];
    });
}

- (void)analyze:(NSDictionary *)message {
    NSDictionary *trade=[message[@"trade"] isKindOfClass:NSDictionary.class]?message[@"trade"]:nil;
    NSString *identifier=[trade[@"id"] isKindOfClass:NSString.class]?trade[@"id"]:@"",*key=[self apiKey];
    NSRegularExpression *idPattern=[NSRegularExpression regularExpressionWithPattern:@"^[A-Za-z0-9_-]{1,100}$" options:0 error:nil];
    if(!key.length||![idPattern numberOfMatchesInString:identifier options:0 range:NSMakeRange(0,identifier.length)]){[self emit:@"analysisError" data:@{@"id":identifier,@"message":@"请先保存 API Key，并选择有效账单"}];return;}
    if(!self.analysisStreams)self.analysisStreams=[NSMutableDictionary dictionary];
    if(self.analysisStreams[identifier]||self.analysisStreams.count>=2){[self emit:@"analysisError" data:@{@"id":identifier,@"message":@"已有复盘正在生成，请完成后重试"}];return;}
    NSDictionary *sample=[message[@"sample"] isKindOfClass:NSDictionary.class]?message[@"sample"]:@{@"trade":trade,@"market":message[@"market"]?:@[]};
    NSString *prompt=[[NSString alloc] initWithData:[NSJSONSerialization dataWithJSONObject:sample options:0 error:nil] encoding:NSUTF8StringEncoding];
    NSString *systemPrompt=[NSString stringWithContentsOfFile:[NSBundle.mainBundle.resourcePath stringByAppendingPathComponent:@"review-system-prompt.txt"] encoding:NSUTF8StringEncoding error:nil];
    if(!systemPrompt.length||!prompt.length){[self emit:@"analysisError" data:@{@"id":identifier,@"message":@"复盘配置或数据缺失"}];return;}
    NSDictionary *body=@{@"model":@"deepseek-v4-pro",@"thinking":@{@"type":@"enabled"},@"reasoning_effort":@"max",@"stream":@YES,@"messages":@[@{@"role":@"system",@"content":systemPrompt},@{@"role":@"user",@"content":prompt}]};
    NSMutableURLRequest *request=[NSMutableURLRequest requestWithURL:[NSURL URLWithString:@"https://api.deepseek.com/chat/completions"]];request.HTTPMethod=@"POST";request.timeoutInterval=600;
    [request setValue:[NSString stringWithFormat:@"Bearer %@",key] forHTTPHeaderField:@"Authorization"];[request setValue:@"application/json" forHTTPHeaderField:@"Content-Type"];
    request.HTTPBody=[NSJSONSerialization dataWithJSONObject:body options:0 error:nil];
    SSTAgentStream *stream=[SSTAgentStream new];self.analysisStreams[identifier]=stream;
    NSMutableString *content=[NSMutableString string];__block NSString *finish=nil;__weak PaperTradeDelegate *owner=self;
    stream.onDelta=^(NSDictionary *chunk){NSDictionary *choice=[chunk[@"choices"] isKindOfClass:NSArray.class]&&[chunk[@"choices"] count]?chunk[@"choices"][0]:nil;
        NSString *text=choice[@"delta"][@"content"];if([text isKindOfClass:NSString.class]&&text.length){[content appendString:text];[owner emit:@"analysisDelta" data:@{@"id":identifier,@"text":text}];}
        if([choice[@"finish_reason"] isKindOfClass:NSString.class])finish=choice[@"finish_reason"];
    };
    stream.onEnd=^(NSError *error){PaperTradeDelegate *strong=owner;if(!strong)return;[strong.analysisStreams removeObjectForKey:identifier];
        if(error||!content.length||!finish.length){[strong emit:@"analysisError" data:@{@"id":identifier,@"message":error.localizedDescription?:@"复盘输出未完成，请重试"}];return;}
        NSDictionary *record=@{@"id":identifier,@"createdAt":@([[NSDate date] timeIntervalSince1970]),@"analysis":[content copy],@"trade":trade,@"promptVersion":@3,@"model":@"deepseek-v4-pro",@"reasoningEffort":@"max",@"sample":sample,@"truncated":@([finish isEqual:@"length"])};
        NSString *filename=[NSString stringWithFormat:@"analysis-%@.json",identifier],*existing=[[strong dataDirectory] stringByAppendingPathComponent:filename];
        if([[NSFileManager defaultManager] fileExistsAtPath:existing]){NSString *archive=[[strong dataDirectory] stringByAppendingPathComponent:@"analysis-history"];[[NSFileManager defaultManager] createDirectoryAtPath:archive withIntermediateDirectories:YES attributes:nil error:nil];[[NSFileManager defaultManager] copyItemAtPath:existing toPath:[archive stringByAppendingPathComponent:[NSString stringWithFormat:@"%.0f-%@",NSDate.date.timeIntervalSince1970*1000,filename]] error:nil];}
        NSError *saveError=nil;if(![strong writeJSON:record name:filename error:&saveError]){[strong emit:@"analysisError" data:@{@"id":identifier,@"message":saveError.localizedDescription?:@"复盘保存失败"}];return;}
        [strong appendRecord:@{@"type":@"analysis",@"data":record}];[strong emit:@"analysis" data:record];
    };
    [stream start:request];
}

- (void)userContentController:(WKUserContentController *)controller didReceiveScriptMessage:(WKScriptMessage *)scriptMessage {
    (void)controller;
    NSDictionary *message = [scriptMessage.body isKindOfClass:NSDictionary.class] ? scriptMessage.body : nil;
    NSString *type = message[@"type"];
    if ([type isEqual:@"ready"]) {
        NSData *data = [NSData dataWithContentsOfFile:[[self dataDirectory] stringByAppendingPathComponent:@"state.json"]];
        id saved = data ? [NSJSONSerialization JSONObjectWithData:data options:0 error:nil] : @{};
        [self emit:@"initialState" data:@{ @"state": saved ?: @{}, @"hasKey": @([self apiKey].length > 0), @"dataPath": [self dataDirectory], @"tradeLogPath": [self tradeLogDirectory], @"analyses": [self savedAnalyses], @"agentChat": [self agentChatRecords] }];
        [self scheduleLogExport];
    } else if ([type isEqual:@"fetchSeedTags"]) [self fetchSeedTags];
    else if ([type isEqual:@"openTradeLog"]) {
        NSURL *directory = [NSURL fileURLWithPath:[self tradeLogDirectory]];
        NSURL *editor = [[NSWorkspace sharedWorkspace] URLForApplicationWithBundleIdentifier:@"com.microsoft.VSCode"];
        if (editor) [[NSWorkspace sharedWorkspace] openURLs:@[directory] withApplicationAtURL:editor configuration:[NSWorkspaceOpenConfiguration configuration] completionHandler:nil];
        else [[NSWorkspace sharedWorkspace] openURL:directory];
        [self scheduleLogExport];
    }
    else if ([type isEqual:@"fetchKlines"]) [self fetchKlines:message];
    else if ([type isEqual:@"fetchSymbols"]) [self fetchSymbols:message];
    else if ([type isEqual:@"fetchDiscoveryQuotes"]) [self fetchTopSymbols:@{ @"source": message[@"source"] ?: @"binance", @"onlyQuotes": @YES }];
    else if ([type isEqual:@"fetchTopSymbols"]) [self fetchTopSymbols:message];
    else if ([type isEqual:@"fetchContractRisk"]) {
        self.riskSymbols = [message[@"symbols"] isKindOfClass:NSArray.class] ? message[@"symbols"] : @[];
        [self fetchContractRisk:message];
    }
    else if ([type isEqual:@"stream"]) [self startStream:message[@"symbols"] interval:message[@"interval"] source:message[@"source"]];
    else if ([type isEqual:@"saveState"]) {
        NSError *error = nil;
        BOOL ok = [self writeJSON:message[@"state"] name:@"state.json" error:&error];
        if (!ok) [self emit:@"storageError" data:@{ @"message": error.localizedDescription ?: @"无法保存本地数据" }];
    } else if ([type isEqual:@"record"] && [message[@"record"] isKindOfClass:NSDictionary.class]) [self appendRecord:message[@"record"]];
    else if ([type isEqual:@"saveMarket"]) {
        NSString *symbol = message[@"symbol"], *interval = message[@"interval"], *source = [self marketSource:message[@"source"]];
        if ([self validSymbol:symbol] && [self validInterval:interval])
            [self writeJSON:@{ @"symbol": symbol, @"interval": interval, @"source": source, @"candles": message[@"candles"] ?: @[] }
                name:[NSString stringWithFormat:@"market-%@-%@-%@.json", source, symbol, interval] error:nil];
    } else if ([type isEqual:@"saveKey"]) [self saveKey:message[@"key"] ?: @""];
    else if ([type isEqual:@"fetchAnalysisContext"]) [self fetchAnalysisContext:message];
    else if ([type isEqual:@"analyze"]) [self analyze:message];
    else if ([type isEqual:@"askAgent"]) [self askAgent:message];
    else if ([type isEqual:@"cancelAgent"]) {if([message[@"id"] isEqual:self.chatID])[self.chatStream cancel];}
    else if ([type isEqual:@"saveAgentConversation"]) [self saveAgentConversation:message];
    else if ([type isEqual:@"agentReadTraining"]) [self agentReadTraining:message];
}
@end

int main(int argc, const char *argv[]) {
    @autoreleasepool {
        NSApplication *application = [NSApplication sharedApplication];
        PaperTradeDelegate *delegate = [[PaperTradeDelegate alloc] init];
        application.delegate = delegate;
        [application setActivationPolicy:NSApplicationActivationPolicyRegular];
        [application run];
    }
    return 0;
}
