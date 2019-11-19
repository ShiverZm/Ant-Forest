importClass(android.content.Context)
importClass(android.provider.Settings)

let { config, storage_name } = require('../config.js')
let { formatDate } = require('./DateUtil.js')
let RUNTIME_STORAGE = storage_name + "_runtime"
let ENERGY_TAG = 'energy'
let RUN_TIMES_TAG = 'runTimes'
let PROTECT_TAG = 'protectList'
let FRIEND_COLLECT_TAG = 'friendCollect'
let RUNNING_PACKAGE = 'runningPackage'
let TIMER_AUTO_START = "timerAutoStart"
let floatyWindow = null
let Timers = require('./Timers.js')(runtime, this)
let {
  FileUtils
} = require('./FileUtils.js')
let {
  debugInfo, logInfo, infoLog, warnInfo, errorInfo, appendLog
} = require('./LogUtils.js')


function CommonFunctions () {

  /**
   * 校验是否已经拥有无障碍权限 没有自动获取 前提是获取了adb权限
   * 原作者：MrChen 原始代码来自Pro商店
   * adb授权方法：开启usb调试并使用adb工具连接手机，执行 adb shell pm grant org.autojs.autojspro android.permission.WRITE_SECURE_SETTING
   * 取消授权 adb shell pm revoke org.autojs.autojspro android.permission.WRITE_SECURE_SETTING
   * 其中免费版包名为 org.autojs.autojs
   * @param {boolean} force 是否强制启用
   */
  this.checkAccessibilityService = function (force) {
    let packageName = this.getAutoJsPackage()
    let requiredService = packageName + '/com.stardust.autojs.core.accessibility.AccessibilityService'
    try {
      let enabledServices = Settings.Secure.getString(context.getContentResolver(), Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES)
      debugInfo(['当前已启用无障碍功能的服务:{}', enabledServices])
      var service = null
      if (enabledServices.indexOf(requiredService) < 0) {
        service = enabledServices + ':' + requiredService
      } else if (force) {
        // 如果强制开启
        service = enabledServices
      }
      if (service) {
        Settings.Secure.putString(context.getContentResolver(), Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES, service)
        Settings.Secure.putString(context.getContentResolver(), Settings.Secure.ACCESSIBILITY_ENABLED, '1')
        infoLog('成功开启AutoJS的辅助服务', true)
      }

      return true
    } catch (e) {
      warnInfo('\n请确保已给予 WRITE_SECURE_SETTINGS 权限\n\n授权代码已复制，请使用adb工具连接手机执行(重启不失效)\n\n', true)
      let shellScript = 'adb shell pm grant ' + packageName + ' android.permission.WRITE_SECURE_SETTINGS'
      warnInfo('adb 脚本 已复制到剪切板：[' + shellScript + ']')
      setClip(shellScript)
      return false
    }
  }


  this.getAutoJsPackage = function () {
    let isPro = app.versionName.match(/[Pp]ro/)
    return 'org.autojs.autojs' + (isPro ? 'pro' : '')
  }

  this.getAndUpdateSpringboard = function (newVal) {
    let storedRunningPackage = this.getTodaysRuntimeStorage(RUNNING_PACKAGE)
    let oldVal = storedRunningPackage.beforeSpringboard
    storedRunningPackage.beforeSpringboard = newVal
    this.updateRuntimeStorage(RUNNING_PACKAGE, storedRunningPackage)
    return oldVal
  }

  this.getAndUpdateBeforeStarting = function (newVal) {
    let storedRunningPackage = this.getTodaysRuntimeStorage(RUNNING_PACKAGE)
    let oldVal = storedRunningPackage.startingPackage
    storedRunningPackage.startingPackage = newVal
    this.updateRuntimeStorage(RUNNING_PACKAGE, storedRunningPackage)
    return oldVal
  }

  /**
   * 启动autojs作为跳板，否则MIUI开发板可能会死机
   * @param reopen 是否属于重开，重开则不记录启动前package信息
   */
  this.launchAutoJs = function (reopen) {
    debugInfo('准备启动AutoJS作为跳板')
    sleep(1000)
    let launchPackage = this.getAutoJsPackage()
    let currentRunning = this.getExactlyCurrentPackage(reopen)

    let beforeSpringboard = ''
    if (!reopen) {
      debugInfo('启动跳板前所在AppPackage:' + currentRunning)
      beforeSpringboard = currentRunning
      debugInfo(['记录启动跳板前package：{}', beforeSpringboard])
    }
    this.getAndUpdateSpringboard(beforeSpringboard)
    if (currentRunning !== launchPackage) {
      app.launchPackage(launchPackage)
      sleep(1000)
      currentRunning = currentPackage()
      let wait = 3
      while (currentRunning !== launchPackage && wait-- > 0) {
        debugInfo(['未进入AutoJS，继续等待 当前package：{}', currentRunning])
        sleep(1000)
      }
    }

  }


  /**
   * 启动package
   * @param packageName 需要启动的package名称
   * @param reopen 是否属于重开，重开则不记录启动前package信息
   */
  this.launchPackage = function (packageName, reopen) {
    debugInfo(['准备{}打开package: {}', reopen ? '重新' : '', packageName])
    let currentRunning = currentPackage()
    let storedRunningPackage = this.getTodaysRuntimeStorage(RUNNING_PACKAGE)
    let beforeSpringboard = storedRunningPackage.beforeSpringboard
    if (!reopen) {
      debugInfo(['启动:{}前所在package: {} 已记录的启动跳板前package: {}', packageName, currentRunning, beforeSpringboard])
    }
    app.launchPackage(packageName)
    sleep(1000)
    currentRunning = currentPackage()
    let waitCount = 3
    while (currentRunning !== packageName && waitCount-- > 0) {
      debugInfo(['未进入{}，继续等待 当前所在：{}', packageName, currentRunning])
      sleep(1000)
      currentRunning = currentPackage()
    }
    debugInfo(['进入[{}] {}', packageName, (packageName === currentRunning ? '成功' : '失败')])
  }

  this.reopenPackageBeforeRunning = function () {
    let _this = this
    threads.start(function () {
      let { startingPackage } = _this.showPackageBeforeRunning()
      if (startingPackage !== _this.getAutoJsPackage() && !startingPackage.match(/(com.android)|(system)|(baidu.input)|(home)/)) {
        if (startingPackage === 'com.eg.android.AlipayGphone') {
          // 支付宝界面直接不动
          return
        }
        let warningDialog = dialogs.build({
          title: '正在重新打开APP，请稍等...',
          content: '目标package：' + startingPackage,
          cancelable: false
        }).show()
        sleep(500)
        if (config.fuck_miui11) {
          _this.launchAutoJs(true)
        }
        debugInfo(['重新打开：{}', startingPackage])
        _this.launchPackage(startingPackage, true)
        sleep(500)
        warningDialog.dismiss()
      } else {
        debugInfo(['startingPackage: {} 在黑名单中不打开', startingPackage])
        home()
      }
    })
  }

  this.showPackageBeforeRunning = function () {
    let storedRunningPackage = this.getTodaysRuntimeStorage(RUNNING_PACKAGE)
    let beforeSpringboard = this.getAndUpdateSpringboard('')
    debugInfo(['启动跳板前package: {} 开始蚂蚁森林前package: {}', beforeSpringboard, storedRunningPackage.startingPackage])
    return { startingPackage: storedRunningPackage.startingPackage }
  }


  this.getExactlyCurrentPackage = function (reopen) {
    let runningPackage = currentPackage()
    if (config.fuck_miui11 && !reopen) {
      // miui 经常没法获取到正确的package 打开最近任务并返回多次 可能会拿到
      let tryTime = 2
      while (runningPackage.match(/(com.android)|(systemui)|(baidu.input)|(autojs)/) && tryTime-- > 0) {
        recents()
        sleep(500)
        back()
        sleep(500)
        runningPackage = currentPackage()
      }
      if (tryTime < 2) {
        sleep(1000)
      }
    }
    return runningPackage
  }
  /**
   * 记录启动前所在的app
   */
  this.recordCurrentPackage = function () {
    let beforeSpringboard = this.getAndUpdateSpringboard('')
    if (beforeSpringboard) {
      this.getAndUpdateSpringboard(beforeSpringboard)
      this.getAndUpdateBeforeStarting(beforeSpringboard)
      debugInfo('维持重新打开的package为跳板前数据：' + beforeSpringboard)
    } else {
      sleep(500)
      let currentRunning = this.getExactlyCurrentPackage()
      debugInfo(['启动前所在package：{} 已记录的跳板前package：{}', currentRunning, beforeSpringboard])
      this.getAndUpdateSpringboard(beforeSpringboard)
      this.getAndUpdateBeforeStarting(currentRunning)
      debugInfo('更新重新打开的package为当前启动前数据：' + currentRunning)
    }
  }

  /**
   * @param checkSpringboard 是否校验是否在跳板前展示过
   */
  this.showDialogAndWait = function (checkSpringboard) {
    if (checkSpringboard) {
      this.listenDelayCollect()
      let storedRunningPackage = this.getTodaysRuntimeStorage(RUNNING_PACKAGE)
      if (storedRunningPackage.beforeSpringboard) {
        debugInfo(['跳转跳板已经提示过，不再展示延迟对话框，跳板前package：{}', storedRunningPackage.beforeSpringboard])
        return
      }
    }

    let continueRunning = true
    let terminate = false
    let showDialog = true
    let lock = threads.lock()
    let complete = lock.newCondition()

    lock.lock()
    threads.start(function () {

      let sleepCount = config.delayStartTime / 1000
      let confirmDialog = dialogs.build({
        title: '即将开始收集能量',
        content: '将在' + sleepCount + '秒内开始收集',
        positive: '立即开始',
        positiveColor: '#f9a01c',
        negative: '终止',
        negativeColor: 'red',
        neutral: '延迟五分钟',
        cancelable: false
      })
        .on('positive', () => {
          lock.lock()
          complete.signal()
          lock.unlock()
          showDialog = false
          confirmDialog.dismiss()
        })
        .on('negative', () => {
          continueRunning = false
          terminate = true
          lock.lock()
          complete.signal()
          lock.unlock()
          showDialog = false
          confirmDialog.dismiss()
        })
        .on('neutral', () => {
          continueRunning = false
          lock.lock()
          complete.signal()
          lock.unlock()
          showDialog = false
          confirmDialog.dismiss()
        })
        .show()

      while (sleepCount-- > 0 && showDialog) {
        sleep(1000)
        confirmDialog.setContent('将在' + sleepCount + '秒内开始收集')
      }
      confirmDialog.setContent('即将开始收集')
      sleep(500)
      lock.lock()
      complete.signal()
      lock.unlock()
      confirmDialog.dismiss()
    })
    complete.await()
    lock.unlock()
    if (terminate) {
      warnInfo('中止执行')
      this.cancelAllTimedTasks()
      exit()
    }
    if (continueRunning) {
      logInfo('立即开始')
    } else {
      logInfo('延迟五分钟后开始')
      this.setUpAutoStart(5)
      exit()
    }
  }

  /**
   * 关闭悬浮窗并将floatyWindow置为空，在下一次显示时重新新建悬浮窗 因为close之后的无法再次显示
   */
  this.closeFloatyWindow = function () {
    floaty.closeAll()
    floatyWindow = null
  }

  /**
   * 显示mini悬浮窗
   */
  this.showMiniFloaty = function (text, x, y, color) {
    // todo 删除日志
    let initialize = false
    if (this.isEmpty(floatyWindow)) {
      initialize = true
      debugInfo('准备展示悬浮窗')
      try {
        floatyWindow = floaty.rawWindow(
          <frame gravity="left">
            <text id="content" textSize="8dp" textColor="#00ff00" />
          </frame>
        )
        let floaty_x = x || config.min_floaty_x || 150
        let floaty_y = y || config.min_floaty_y || 20
        floatyWindow.setPosition(parseInt(floaty_x), parseInt(floaty_y))
        debugInfo('设置悬浮窗位置完毕： textColor:' + floatyWindow.content.textColor)
      } catch (e) {
        errorInfo('创建悬浮窗异常' + e)
      }
      sleep(500)
    }
    if (initialize) {
      debugInfo('准备设置悬浮窗文字')
    }
    ui.run(function () {
      let floatyColor = color || config.min_floaty_color || '#00FF00'
      floatyWindow.content.setTextColor(android.graphics.Color.parseColor(floatyColor))
      floatyWindow.content.text(text)
      if (initialize) {
        debugInfo('悬浮窗功能执行完毕:' + text)
      }
    })

    if (color) {
      setTimeout(() => {
        floatyWindow.close()
        floatyWindow = null
      }, 5000)
    }

  }

  /**
   * 显示悬浮窗 根据配置自动显示mini悬浮窗和可关闭悬浮窗，目前来说不推荐使用可关闭悬浮窗
   * @param text {String} 悬浮窗文字内容
   */
  this.showTextFloaty = function (text) {
    if (config.show_small_floaty) {
      this.showMiniFloaty(text)
    } else {
      this.showCloseableFloaty(text)
    }
  }

  /**
   * 显示可关闭悬浮窗 不推荐使用 不友好
   */
  this.showCloseableFloaty = function (text) {
    if (this.isEmpty(floatyWindow)) {
      floatyWindow = floaty.window(
        <card cardBackgroundColor="#aa000000" cardCornerRadius="20dp">
          <horizontal w="200" h="35" paddingLeft="15" gravity="center">
            <text
              id="content"
              w="120"
              h="25"
              textSize="10dp"
              textColor="#ffffff"
              layout_gravity="center"
              gravity="left|center"
            />
            <card
              id="stop"
              w="25"
              h="25"
              cardBackgroundColor="#fafafa"
              cardCornerRadius="15dp"
              layout_gravity="right|center"
              paddingRight="-15"
            >
              <text
                w="25"
                h="25"
                textSize="16dp"
                textColor="#000000"
                layout_gravity="center"
                gravity="center"
              >
                ×
            </text>
            </card>
          </horizontal>
        </card>
      )
      // w.setSize(180, 30)
      floatyWindow.stop.on('click', () => {
        floatyWindow.close()
        floatyWindow = null
      })
    }
    ui.run(function () {
      floatyWindow.content.text(text)
    })

  }

  /**
   * 监听音量下键延迟执行
   **/
  this.listenDelayCollect = function () {
    let _this = this
    threads.start(function () {
      infoLog('即将收取能量，按音量下键延迟五分钟执行', true)
      events.observeKey()
      events.onceKeyDown('volume_down', function (event) {
        if (config.autoSetBrightness) {
          device.setBrightnessMode(1)
        }
        warnInfo('延迟五分钟后启动脚本', true)
        _this.setUpAutoStart(5)
        engines.myEngine().forceStop()
        exit()
      })
    })
  }

  this.commonDelay = function (minutes, text) {
    debugInfo('倒计时' + minutes)
    if (typeof text === 'undefined' || text === '') {
      text = '距离下次运行还有['
    }

    minutes = typeof minutes != null ? minutes : 0
    if (minutes === 0) {
      return
    }
    let startTime = new Date().getTime()
    let timestampGap = minutes * 60000
    let i = 0
    let delayLogStampPoint = -1
    let delayLogGap = 0
    let showSeconds = false
    for (; ;) {
      let now = new Date().getTime()
      if (now - startTime > timestampGap) {
        break
      }
      i = (now - startTime) / 60000
      let left = minutes - i
      if (!showSeconds) {
        delayLogGap = i - delayLogStampPoint
        // 半分钟打印一次日志
        if (delayLogGap >= 0.5) {
          delayLogStampPoint = i
          let content = this.formatString('{}{}]分', text, left.toFixed(2))
          this.showTextFloaty(content)
          debugInfo(content)
        }
        // 剩余一分钟时显示为秒
        if (showSeconds === false && left <= 1) {
          this.listenDelayCollect()
          showSeconds = true
        }
        sleep(500)
      } else {
        let content = this.formatString('{}{}]秒', text, (left * 60).toFixed(0))
        this.showTextFloaty(content)
        sleep(1000)
      }
    }
  }

  this.persistHistoryEnergy = function (energy) {
    let string = formatDate(new Date()) + ':' + energy + 'g\n'
    try {
      files.append(FileUtils.getRealMainScriptPath(true) + '/history-energy.log', string)
    } catch (e) {
      errorInfo('保存历史能量数据失败')
    }
  }

  /**
   * 根据传入key创建当日缓存
   */
  this.createTargetStore = function (key, today) {
    if (key === ENERGY_TAG) {
      return this.createEnergyStore(today)
    } else if (key === RUN_TIMES_TAG) {
      return this.createRunTimesStore(today)
    } else if (key === PROTECT_TAG) {
      return this.createProtectStore(today)
    } else if (key === FRIEND_COLLECT_TAG) {
      return this.createFriendCollectStore(today)
    } else if (key === RUNNING_PACKAGE) {
      return this.createRunningPackage(today)
    }
  }

  /**
   * 创建能量信息缓存
   */
  this.createEnergyStore = function (today) {
    let initEnergy = {
      date: today,
      totalIncrease: 0
    }
    let runtimeStorages = storages.create(RUNTIME_STORAGE)
    runtimeStorages.put(ENERGY_TAG, JSON.stringify(initEnergy))
    return initEnergy
  }

  /**
   * 创建运行次数缓存
   */
  this.createRunTimesStore = function (today) {
    let initRunTimes = {
      date: today,
      runTimes: 0
    }

    let runtimeStorages = storages.create(RUNTIME_STORAGE)
    runtimeStorages.put(RUN_TIMES_TAG, JSON.stringify(initRunTimes))
    return initRunTimes
  }

  /**
   * 创建能量保护信息缓存
   */
  this.createProtectStore = function (today) {
    let initProtect = {
      date: today,
      protectList: []
    }
    let runtimeStorages = storages.create(RUNTIME_STORAGE)
    runtimeStorages.put(PROTECT_TAG, JSON.stringify(initProtect))
    return initProtect
  }

  /**
   * 创建好友收集信息
   */
  this.createFriendCollectStore = function (today) {
    let initFriendCollect = {
      date: today,
      collectInfos: []
    }
    let runtimeStorages = storages.create(RUNTIME_STORAGE)
    runtimeStorages.put(FRIEND_COLLECT_TAG, JSON.stringify(initFriendCollect))
    return initFriendCollect
  }


  this.createRunningPackage = function (today) {
    let initRunningPackage = {
      beforeSpringboard: '',
      startingPackage: '',
      date: today
    }
    let runtimeStorages = storages.create(RUNTIME_STORAGE)
    runtimeStorages.put(RUNNING_PACKAGE, JSON.stringify(initRunningPackage))
    return initRunningPackage
  }

  /**
   * 获取当天的缓存信息，不存在时创建一个初始值
   * @param key {String} key名称
   */
  this.getTodaysRuntimeStorage = function (key) {
    let today = formatDate(new Date(), 'yyyy-MM-dd')
    let runtimeStorages = storages.create(RUNTIME_STORAGE)
    let existStoreObjStr = runtimeStorages.get(key)
    if (existStoreObjStr) {
      try {
        let existStoreObj = JSON.parse(existStoreObjStr)
        if (existStoreObj.date === today) {
          return existStoreObj
        }
      } catch (e) {
        debugInfo(["解析JSON数据失败, key:{} value:{} error:{}", key, existStoreObjStr, e])
      }
    }
    return this.createTargetStore(key, today)
  }

  /**
   * 通用更新缓存方法
   * @param key {String} key值名称
   * @param valObj {Object} 存值对象
   */
  this.updateRuntimeStorage = function (key, valObj) {
    let runtimeStorages = storages.create(RUNTIME_STORAGE)
    runtimeStorages.put(key, JSON.stringify(valObj))
  }

  /**
   * 存储能量值
   */
  this.storeEnergy = function (newVal) {
    let existEnergy = this.getTodaysRuntimeStorage(ENERGY_TAG)
    if (this.isEmpty(existEnergy.startEnergy)) {
      existEnergy.startEnergy = newVal
    }
    // 获取已存在的能量值
    let existEnergyVal = existEnergy.existVal

    existEnergy.preEnergy = existEnergyVal
    existEnergy.existVal = newVal
    existEnergy.totalIncrease = newVal - existEnergy.startEnergy
    // 更新存储数据
    this.updateRuntimeStorage(ENERGY_TAG, existEnergy)
  }

  /**
   * 增加运行次数 并返回当前运行次数
   */
  this.increaseRunTimes = function () {
    let runTimesStore = this.getTodaysRuntimeStorage(RUN_TIMES_TAG)
    let preRunTimes = runTimesStore.runTimes || 0
    runTimesStore.runTimes = preRunTimes + 1
    this.updateRuntimeStorage(RUN_TIMES_TAG, runTimesStore)
    return preRunTimes + 1
  }

  /**
   * 记录好友收集信息
   * @param friendCollect 包含好友信息
   * friendName 好友名
   * friendEnergy 好友能量总数
   * preCollect 收集前数据
   * postCollect 收集后数据
   * helpCollect 本次帮助收集能量数
   * @return {boolean} 是否浇水
   */
  this.recordFriendCollectInfo = function (friendCollect) {
    debugInfo('保存收集数据' + JSON.stringify(friendCollect))
    let friendCollectStore = this.getTodaysRuntimeStorage(FRIEND_COLLECT_TAG)
    let existCollectList = friendCollectStore.collectInfos
    let existCollectInfoIndex = existCollectList.findIndex(
      (collectInfo) => collectInfo.friendName === friendCollect.friendName
    )
    let collectInfo
    let needWateringBack = false
    if (existCollectInfoIndex > -1) {
      // 获取已存在的能量收集信息
      collectInfo = existCollectList[existCollectInfoIndex]
      collectInfo.friendEnergy = friendCollect.friendEnergy
      // 今日收集能量起始值
      collectInfo.initCollect = collectInfo.initCollect === undefined ? (collectInfo.preCollect || 0) : collectInfo.initCollect
      // 总共已收集ta的能量
      collectInfo.totalCollect = friendCollect.postCollect
    } else {
      collectInfo = this.getInitCollectInfo(friendCollect)
    }
    // 今日收集ta的能量数
    collectInfo.todayCollect = collectInfo.totalCollect - collectInfo.initCollect
    collectInfo.todayHelp += friendCollect.helpCollect || 0

    // 浇水统计 
    if (
      config.wateringBack === true &&
      // 今日收集大于阈值，且未浇过水
      collectInfo.todayCollect > config.wateringThresold && collectInfo.todayWatering <= 0
      // 不在浇水黑名单内
      && !(config.wateringBlackList && config.wateringBlackList.indexOf(friendCollect.friendName) > -1)
    ) {
      infoLog("已收集[" + collectInfo.friendName + "] " + collectInfo.todayCollect + "g 给他浇浇水")
      needWateringBack = true
      // 今日浇水递增
      collectInfo.todayWatering += 10
    } else {
      needWateringBack = false
    }

    if (existCollectInfoIndex > -1) {
      existCollectList[existCollectInfoIndex] = this.parseFieldToInts(collectInfo)
    } else {
      existCollectList.push(this.parseFieldToInts(collectInfo))
    }

    debugInfo('收集后保存收集好友数据：' + JSON.stringify(this.parseFieldToInts(collectInfo)))
    friendCollectStore.collectInfos = existCollectList
    this.updateRuntimeStorage(FRIEND_COLLECT_TAG, friendCollectStore)
    return needWateringBack
  }

  /**
   * 将某些字符串类型的强转成int
   */
  this.parseFieldToInts = function (collectInfo) {
    collectInfo.initCollect = this.parseToZero(collectInfo.initCollect)
    collectInfo.totalCollect = this.parseToZero(collectInfo.totalCollect)
    collectInfo.friendEnergy = this.parseToZero(collectInfo.friendEnergy)
    collectInfo.todayCollect = this.parseToZero(collectInfo.todayCollect)
    collectInfo.todayHelp = this.parseToZero(collectInfo.todayHelp)
    collectInfo.todayWatering = this.parseToZero(collectInfo.todayWatering)
    return collectInfo
  }

  this.parseToZero = function (value) {
    return (!value || isNaN(value)) ? 0 : parseInt(value)
  }

  this.getInitCollectInfo = function (friendCollect) {
    return {
      // 好友名称
      friendName: friendCollect.friendName,
      // 收集后好友能量
      friendEnergy: friendCollect.friendEnergy || 0,
      // 今日初始收集数量 不传递值则使用收集后的数据
      initCollect: friendCollect.preCollect || (friendCollect.postCollect || undefined),
      // 总共收集数量
      totalCollect: friendCollect.postCollect || 0,
      // 今日收集总量
      todayCollect: 0,
      // 今日帮助总量
      todayHelp: 0,
      todayWatering: 0
    }
  }

  /**
   * 打印概述信息
   */
  this.showCollectSummary = function (sortBy) {
    let sortKey = sortBy || 'totalCollect'
    let todayCollectStore = this.getTodaysRuntimeStorage(FRIEND_COLLECT_TAG)
    let date = todayCollectStore.date
    let collectInfos = todayCollectStore.collectInfos
    let toweekCollectSum = 0
    let todayCollectSum = 0
    let todayWateringSum = 0
    log('收取日期：' + date)
    log('--------------------------')
    collectInfos = collectInfos.sort((a, b) => {
      if (a[sortKey] < b[sortKey]) {
        return 1
      } else if (a[sortKey] === b[sortKey]) {
        return 0
      }
      return -1
    })
    let seq = 0
    for (let collectInfo of collectInfos) {
      collectInfo = this.parseFieldToInts(collectInfo)
      log('[' + ++seq + ']好友：' + collectInfo.friendName + ' 拥有总能量：' + collectInfo.friendEnergy + 'g')
      toweekCollectSum += collectInfo.totalCollect || 0
      todayCollectSum += collectInfo.todayCollect || 0
      todayWateringSum += collectInfo.todayWatering || 0
      if (collectInfo.todayCollect !== 0) {
        console.info('今日收取ta：' + collectInfo.todayCollect + 'g')
      }
      log('本周收取ta：' + collectInfo.totalCollect + 'g')
      log('今日帮ta收取：' + collectInfo.todayHelp + 'g')
      log('今日帮ta浇水：' + collectInfo.todayWatering + 'g')
      log('--------------------------')
    }
    if (collectInfos.length >= 1) {
      let toweekMaxCollect = collectInfos.sort((a, b) => {
        if (a.totalCollect < b.totalCollect) {
          return 1
        } else if (a.totalCollect === b.totalCollect) {
          return 0
        }
        return -1
      })[0]
      log('本周收取最多的是：' + toweekMaxCollect.friendName + ' 总量：' + toweekMaxCollect.totalCollect + 'g')
      let todayMaxCollect = collectInfos.sort((a, b) => {
        if (a.todayCollect < b.todayCollect) {
          return 1
        } else if (a.todayCollect === b.todayCollect) {
          return 0
        }
        return -1
      })[0]
      log('今日收取最多的是：' + todayMaxCollect.friendName + ' 总量：' + todayMaxCollect.todayCollect + 'g')
      let todayMaxHelp = collectInfos.sort((a, b) => {
        if (a.todayHelp < b.todayHelp) {
          return 1
        } else if (a.todayHelp === b.todayHelp) {
          return 0
        }
        return -1
      })[0]
      log('今日帮助最多的是：' + todayMaxHelp.friendName + ' 总量：' + todayMaxHelp.todayHelp + 'g')
      log('--------------------------')
    }
    log('本周收集好友能量：' + toweekCollectSum + 'g')
    log('今日收集好友能量：' + todayCollectSum + 'g')
    log('今日自动浇水：' + todayWateringSum + 'g')
    let protectStore = this.getTodaysRuntimeStorage(PROTECT_TAG)
    log('以下好友使用了能量保护罩：' + protectStore.protectList)
  }

  /**
   * 打印能量收集信息
   */
  this.showEnergyInfo = function () {
    let existEnergy = this.getTodaysRuntimeStorage(ENERGY_TAG)
    let runTimesStore = this.getTodaysRuntimeStorage(RUN_TIMES_TAG)
    let date = existEnergy.date
    let startEnergy = existEnergy.startEnergy
    let endEnergy = existEnergy.existVal
    let preEnergy = existEnergy.preEnergy || startEnergy
    let runTimes = runTimesStore.runTimes || 0
    let summary = "日期：" + date + "，启动时能量:" + startEnergy + "g" +
      (runTimes > 0
        ? ", 截止当前已收集:" + (endEnergy - startEnergy) + "g, 已运行[" + runTimes + "]次, 上轮收集:" + (endEnergy - preEnergy) + "g"
        : "")
    logInfo(summary)
    return existEnergy
  }

  /**
   * 校验好友名字是否在保护列表中 当前判断只能说当天不会再收取，无法判断好友保护罩什么时候消失 功能待强化
   */
  this.checkIsProtected = function (objName) {
    let protectStore = this.getTodaysRuntimeStorage(PROTECT_TAG)
    if (this.isEmptyArray(protectStore.protectList)) {
      return false
    }
    return protectStore.protectList.indexOf(objName) > -1
  }

  /**
   * 将好友名字存入保护列表
   */
  this.addNameToProtect = function (objName) {
    let protectStore = this.getTodaysRuntimeStorage(PROTECT_TAG)
    protectStore.protectList.push(objName)
    // 更新数据到缓存
    this.updateRuntimeStorage(PROTECT_TAG, protectStore)
  }

  this.isEmpty = function (val) {
    return val === null || typeof val === 'undefined' || val === ''
  }

  this.isEmptyArray = function (array) {
    return array === null || typeof array === 'undefined' || array.length === 0
  }

  this.addOpenPlacehold = function (content) {
    content = "<<<<<<<" + (content || "") + ">>>>>>>"
    appendLog(content)
    console.verbose(content)
  }

  this.addClosePlacehold = function (content) {
    content = ">>>>>>>" + (content || "") + "<<<<<<<"
    appendLog(content)
    console.verbose(content)
  }

  /**
   * 校验是否重复运行 如果重复运行则关闭当前脚本
   */
  this.checkDuplicateRunning = function () {
    let currentEngine = engines.myEngine()
    let runningEngines = engines.all()
    let runningSize = runningEngines.length
    let currentSource = currentEngine.getSource() + ''
    debugInfo('当前脚本信息 id:' + currentEngine.id + ' source:' + currentSource + ' 运行中脚本数量：' + runningSize)
    if (runningSize > 1) {
      runningEngines.forEach(engine => {
        let compareEngine = engine
        let compareSource = compareEngine.getSource() + ''
        debugInfo('对比脚本信息 id:' + compareEngine.id + ' source:' + compareSource)
        if (currentEngine.id !== compareEngine.id && compareSource === currentSource) {
          warnInfo('脚本正在运行中 退出当前脚本：' + currentSource, true)
          engines.myEngine().forceStop()
          exit()
        }
      })
    }
  }

  /**
   * 关闭运行中的脚本
   */
  this.killRunningScript = function () {
    let runningEngines = engines.all()
    let runningSize = runningEngines.length
    let mainScriptJs = FileUtils.getRealMainScriptPath()
    if (runningSize > 1) {
      runningEngines.forEach(engine => {
        let compareEngine = engine
        let compareSource = compareEngine.getSource() + ''
        debugInfo('对比脚本信息 id:' + compareEngine.id + ' source:' + compareSource)
        if (compareSource === mainScriptJs) {
          warnInfo(['关闭运行中脚本：id[{}]', compareEngine.id], true)
          engine.forceStop()
        }
      })
    }
  }

  /**
   * 设置指定时间后自动启动main脚本
   */
  this.setUpAutoStart = function (minutes) {
    // 先移除所有已设置的定时任务
    this.cancelAllTimedTasks()
    let mainScriptJs = FileUtils.getRealMainScriptPath()
    let millis = new Date().getTime() + minutes * 60 * 1000
    infoLog('预订[' + minutes + ']分钟后的任务，时间戳:' + millis)
    // 预定一个{minutes}分钟后的任务
    let task = Timers.addDisposableTask({
      path: mainScriptJs,
      date: millis
    })
    debugInfo("定时任务预定成功: " + task.id)
    this.recordTimedTask(task)
  }

  this.recordTimedTask = function (task) {
    let runtimeStorage = storages.create(RUNTIME_STORAGE)
    let autoStartListStr = runtimeStorage.get(TIMER_AUTO_START)
    let array = []
    if (autoStartListStr) {
      array = JSON.parse(autoStartListStr)
    }
    array.push(task)
    runtimeStorage.put(TIMER_AUTO_START, JSON.stringify(array))
  }

  this.showAllAutoTimedTask = function () {
    let runtimeStorage = storages.create(RUNTIME_STORAGE)
    let autoStartListStr = runtimeStorage.get(TIMER_AUTO_START)
    if (autoStartListStr) {
      let array = JSON.parse(autoStartListStr)
      if (array && array.length > 0) {
        array.forEach(task => {
          logInfo([
            '定时任务 mId: {} 目标执行时间: {} 剩余时间: {}秒',
            task.mId, formatDate(new Date(task.mMillis), 'yyyy-MM-dd HH:mm:ss'), ((task.mMillis - new Date().getTime()) / 1000.0).toFixed(0)
          ])
        })
      }
    } else {
      logInfo('当前没有自动设置的定时任务')
    }
  }

  this.cancelAllTimedTasks = function () {
    let runtimeStorage = storages.create(RUNTIME_STORAGE)
    let autoStartListStr = runtimeStorage.get(TIMER_AUTO_START)
    if (autoStartListStr) {
      let array = JSON.parse(autoStartListStr)
      if (array && array.length > 0) {
        array.forEach(task => {
          debugInfo('撤销自动任务：' + JSON.stringify(task))
          if (task.mId) {
            Timers.removeTimedTask(task.mId)
          }
        })
      }
    }
    // 将task队列置为空
    runtimeStorage.put(TIMER_AUTO_START, '')
  }

  this.waitFor = function (action, timeout) {
    let countDown = new java.util.concurrent.CountDownLatch(1)
    let timeoutThread = threads.start(function () {
      sleep(timeout)
      countDown.countDown()
      debugInfo('超时线程执行结束')
    })
    let actionSuccess = false
    let actionThread = threads.start(function () {
      action()
      actionSuccess = true
      countDown.countDown()
      debugInfo('action执行结束')
    })
    countDown.await()
    timeoutThread.interrupt()
    actionThread.interrupt()
    return actionSuccess
  }

  this.createQueue = function (size) {
    let queue = []
    for (let i = 0; i < size; i++) {
      queue.push(i)
    }
    return queue
  }

  this.getQueueDistinctSize = function (queue) {
    return queue.reduce((a, b) => {
      if (a.indexOf(b) < 0) {
        a.push(b)
      }
      return a
    }, []).length
  }

  this.pushQueue = function (queue, size, val) {
    if (queue.length >= size) {
      queue.shift()
    }
    queue.push(val)
  }

  /**
  * eg. params '参数名：{} 参数内容：{}', name, value
  *     result '参数名：name 参数内容：value'
  * 格式化字符串，定位符{}
  */
  this.formatString = function () {
    let originContent = []
    for (let arg in arguments) {
      originContent.push(arguments[arg])
    }
    if (originContent.length === 1) {
      return originContent[0]
    }
    let marker = originContent[0]
    let args = originContent.slice(1)
    let regex = /(\{\})/g
    let matchResult = marker.match(regex)
    if (matchResult && args && matchResult.length > 0 && matchResult.length === args.length) {
      args.forEach((item, idx) => {
        marker = marker.replace('{}', item)
      })
      return marker
    } else {
      console.error('参数数量不匹配' + arguments)
      return arguments
    }
  }
}

module.exports = {
  commonFunctions: new CommonFunctions()
}