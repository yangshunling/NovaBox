; 卸载时的自定义逻辑。
;
; 用户数据放在 ~/.toolbox（= $PROFILE\.toolbox），里面是数据库 toolbox.db、日志、
; 以及大模型配置等。它不在 %APPDATA%\<productName> 下，所以 electron-builder 的
; deleteAppDataOnUninstall 管不到，只能自己写这个钩子问一句。
;
; 默认按钮是「否」（MB_DEFBUTTON2）—— 用户手一抖回车不该把数据删了。
; 静默卸载（/S）时不会弹窗，此时**保留**数据，这是更安全的一侧。

!macro customUnInstall
  IfSilent toolboxKeepData

  MessageBox MB_YESNO|MB_DEFBUTTON2 "是否同时删除所有数据与配置？$\r$\n$\r$\n将删除：$PROFILE\.toolbox$\r$\n（配置数据库 toolbox.db、运行日志、大模型配置等）$\r$\n$\r$\n选「否」则保留，以后重新安装还能接着用。" IDNO toolboxKeepData

  RMDir /r "$PROFILE\.toolbox"
  DetailPrint "已删除 $PROFILE\.toolbox"

  toolboxKeepData:
!macroend
