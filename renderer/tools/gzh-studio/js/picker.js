/* 主题下拉选择器：基础 / 精选 分组、弹出面板、按主题切换。 */

window.GZH.picker = (function (GZH) {
  'use strict';

  var Themes = GZH.Themes;
  var pickerSlot = GZH.pickerSlot;
  var state = GZH.state;
  var convert = GZH.convert;

  var pickerButtons = {};
  var pickerPop;

  function libraryThemes(library) {
    return Themes.SPECS.filter(function (spec) { return library.groups.indexOf(spec.group) !== -1; });
  }

  function libraryForTheme(spec) {
    for (var i = 0; i < Themes.LIBRARIES.length; i++) {
      if (Themes.LIBRARIES[i].groups.indexOf(spec.group) !== -1) return Themes.LIBRARIES[i];
    }
    return Themes.LIBRARIES[0];
  }

  function closePicker() {
    state.pickerOpen = false;
    if (pickerPop) pickerPop.hidden = true;
    renderPickerButtons();
  }

  function buildPicker() {
    pickerSlot.innerHTML = '';
    Themes.LIBRARIES.forEach(function (library) {
      var button = document.createElement('button');
      button.className = 'picker-btn';
      button.dataset.library = library.id;
      button.type = 'button';
      button.addEventListener('click', function (event) {
        event.stopPropagation();
        var sameOpenLibrary = state.pickerOpen && state.library === library.id;
        state.library = library.id;
        state.group = 'all';
        state.pickerOpen = !sameOpenLibrary;
        pickerPop.hidden = !state.pickerOpen;
        renderPickerButtons();
        if (state.pickerOpen) renderPickerPop();
      });
      pickerButtons[library.id] = button;
      pickerSlot.appendChild(button);
    });
    pickerPop = document.createElement('div');
    pickerPop.className = 'picker-pop';
    pickerPop.id = 'themePickerPop';
    pickerPop.hidden = true;
    pickerPop.addEventListener('click', function (event) { event.stopPropagation(); });
    pickerSlot.appendChild(pickerPop);
    renderPickerButtons();
    renderPickerPop();
  }

  function renderPickerButtons() {
    var spec = Themes.getSpec(state.themeId);
    var selectedLibrary = libraryForTheme(spec);
    Themes.LIBRARIES.forEach(function (library) {
      var button = pickerButtons[library.id];
      var selected = selectedLibrary.id === library.id;
      var open = state.pickerOpen && state.library === library.id;
      var count = libraryThemes(library).length;
      button.classList.toggle('selected', selected);
      button.classList.toggle('open', open);
      button.setAttribute('aria-expanded', String(open));
      button.setAttribute('aria-controls', 'themePickerPop');
      button.setAttribute('aria-label', library.name + (selected ? '，当前为' + spec.name : '，共' + count + '套'));
      button.innerHTML = '<span class="picker-kind">' + library.shortName + '</span>'
        + (selected ? '<span class="swatch" style="background:' + spec.swatch + '"></span><span class="picker-name">' + spec.name + '</span>' : '<span class="picker-count">' + count + ' 套</span>')
        + '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>';
    });
  }

  function renderPickerPop() {
    var library = Themes.LIBRARIES.filter(function (item) { return item.id === state.library; })[0] || Themes.LIBRARIES[0];
    var inLibrary = libraryThemes(library);
    var html = '<div class="pop-head"><span class="pop-title">' + library.en + ' · ' + library.name + '</span><span class="pop-note">' + inLibrary.length + ' THEMES</span></div>';
    if (library.id === 'base') {
      html += '<div class="pop-tabs">';
      Themes.GROUPS.filter(function (group) { return group.id === 'all' || library.groups.indexOf(group.id) !== -1; }).forEach(function (group) {
        var count = group.id === 'all' ? inLibrary.length : inLibrary.filter(function (spec) { return spec.group === group.id; }).length;
        html += '<button class="group-tab' + (state.group === group.id ? ' active' : '') + '" data-group="' + group.id + '">' + group.name + ' <span class="cnt">' + count + '</span></button>';
      });
      html += '</div>';
    }
    html += '<div class="pop-grid">';
    inLibrary.filter(function (spec) { return state.group === 'all' || spec.group === state.group; }).forEach(function (spec) {
      html += '<button class="pop-card' + (spec.id === state.themeId ? ' active' : '') + '" data-id="' + spec.id + '"><span class="swatch" style="background:' + spec.swatch + '"></span><span class="pop-card-text"><span class="tname">' + spec.name + '</span><span class="tdesc">' + spec.desc + '</span></span></button>';
    });
    html += '</div>';
    pickerPop.innerHTML = html;
    pickerPop.querySelectorAll('.group-tab').forEach(function (tab) {
      tab.addEventListener('click', function () { state.group = tab.dataset.group; renderPickerPop(); });
    });
    pickerPop.querySelectorAll('.pop-card').forEach(function (card) {
      card.addEventListener('click', function () {
        state.themeId = card.dataset.id;
        state.library = libraryForTheme(Themes.getSpec(state.themeId)).id;
        closePicker();
        renderPickerButtons();
        convert().catch(function () {});
      });
    });
  }
  return { build: buildPicker, close: closePicker };
})(window.GZH);
