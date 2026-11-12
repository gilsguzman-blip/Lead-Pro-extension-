'use strict';
// (v9.7.835) A placeholder Dealer eProcess click-path page in the shape the store sites serve (see proxy v7.90 parseClickPath):
// one <div class="c-cpblock"> per session, a header date and time range, and a timeline of
// <div class="c-cpblock__item-right l-<type>"> entries. Placeholder data only.
const item = (type, href, title, dwell) => '<div class="c-cp-block__item-left"><span class="c-cpblock__item-ts">10:00:00 AM CDT</span> </div> '
  + '<div class="c-cpblock__item-middle"><div class="c-cpblock__bullet c-cpblock__bullet-' + (type || 'default') + '"></div></div> '
  + '<div class="c-cpblock__item-right l-' + type + '"><a class="c-cpblock__path-link" href="' + href + '" target="_blank">' + title + '</a><span class="c-cpblock__path-delta">' + dwell + '</span> </div>';
const leadItem = (no, current) => '<div class="c-cpblock__item-right l-' + (current ? 'current_lead' : 'lead') + '"><span class="c-cpblock__path-lbl">Lead Submitted - ' + no + '<div class="star_box"></div></span><span class="c-cpblock__path-delta"></span> </div>';
const block = (date, leadNo, current, items) => '<div class="c-cpblock"> <div class="c-cpblock__header"> <span class="c-cpblock__header-ts">' + date + '</span><div class="c-cpblock__header-data-wrap"> '
  + '<span class="c-cpblock__header-leads">1 Submitted Lead</span><span class="c-cpblock__header-pages">3 Pages Viewed </span><span class="c-cpblock__header-range">11:05:06 AM CDT - 11:08:38 AM CDT</span> </div></div> '
  + '<div class="c-cpblock__contents"> <div class="c-cpblock__contents-raw"><span class="c-cpblock__raw-path ' + (current ? 'current_lead' : 'lead') + '">Lead Submitted - ' + leadNo + '</span></div> '
  + '<div class="c-cpblock__contents-timeline">' + items.join('') + leadItem(leadNo, current) + '</div> </div> </div>';
const SITE = 'https://www.example-honda.com';
function page() {
  return '<html><body><div class="c-cpblock-wrap">'
    + block('Thursday, October 08, 2026', '100000001', false, [item('', SITE + '/', 'Homepage', '18s'),
        item('vdp', SITE + '/auto/new-2027-honda-hr-v-sport/100000/', 'new 2027 honda hr v - New 2027 HR-V Honda - Stock# TEST001A', '2m 13s')])
    + block('Tuesday, October 27, 2026', '100000002', true, [item('', SITE + '/', 'Homepage', '11s'),
        item('srp', SITE + '/search/new-honda-accord-sedan/?md=1&tp=new', 'New Honda Accord Sedan for Sale in Lafayette, LA', '3m 14s'),
        item('', SITE + '/contact-us/', 'Contact Us | Lafayette, LA | Test Store', '7s')])
    + block('Thursday, October 29, 2026', '100000003', false, [item('', SITE + '/', 'Homepage', '8s'),
        item('srp', SITE + '/search/new-honda-cr-v/?md=2&tp=new', 'New Honda CR-V for Sale in Lafayette, LA', '2m 45s')])
    + '</div></body></html>';
}
module.exports = { page, SITE, URL: SITE + '/resrc/leadinfo/clickpath/100000002' };
