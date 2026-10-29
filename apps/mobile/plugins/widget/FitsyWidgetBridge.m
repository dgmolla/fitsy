#import <React/RCTBridgeModule.h>

@interface RCT_EXTERN_MODULE(FitsyWidgetBridge, NSObject)
RCT_EXTERN_METHOD(configure:(NSString *)json resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(clear:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject)
@end
