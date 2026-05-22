"""油猴页面下拉框：选项格式化、索引查找与恢复选择。"""

import time



from app.models import normalize_remote_chatgpt

from app.utils.page_status import get_page_liveness, is_page_online, page_url_from

from PyQt5.QtCore import Qt





class TmPageSelectorFormatMixin:



    TM_PAGE_ITEM_DICT_ROLE = Qt.UserRole + 1



    def _tm_page_option_resolve_conversation_id(self, page):

        if not isinstance(page, dict):

            return ""

        conversation_id = (page.get("conversation_id") or "").strip()

        if not conversation_id and hasattr(self, "_client_conversation_id"):

            conversation_id = (self._client_conversation_id(page) or "").strip()

        if not conversation_id and hasattr(self, "_page_chatgpt_conversation_id"):

            conversation_id = (self._page_chatgpt_conversation_id(page) or "").strip()

        return conversation_id



    def _tm_page_option_resolve_url(self, page):

        if not isinstance(page, dict):

            return ""

        url = (page.get("url") or "").strip()

        if not url and hasattr(self, "_page_full_url"):

            url = (self._page_full_url(page) or "").strip()

        if not url:

            conversation_id = self._tm_page_option_resolve_conversation_id(page)

            if conversation_id:

                url = f"https://chatgpt.com/c/{conversation_id}"

        return url



    def _tm_page_option_bind_tag(self, page, **bound_kwargs):

        if hasattr(self, "_tm_page_bind_state_text") and hasattr(self, "_bridge_ui"):

            state = self._tm_page_bind_state_text(page)

            if state == "已绑定":

                return "已绑定"

            if state in ("同对话", "旧绑定"):

                return "已绑定"

            return "未绑定"



        bound_page_instance_id = (bound_kwargs.get("bound_page_instance_id") or "").strip()

        bound_conversation_id = (bound_kwargs.get("bound_conversation_id") or "").strip()

        resolved_bound_client_id = (

            bound_kwargs.get("resolved_bound_client_id") or ""

        ).strip()

        bound_client_id = (bound_kwargs.get("bound_client_id") or "").strip()

        client_id = str(page.get("client_id") or "").strip()

        item_instance = (page.get("page_instance_id") or "").strip()

        item_conv = (

            self._client_conversation_id(page)

            if hasattr(self, "_client_conversation_id")

            else (page.get("conversation_id") or "").strip()

        )

        if bound_page_instance_id and item_instance == bound_page_instance_id:

            return "已绑定"

        if resolved_bound_client_id and client_id == resolved_bound_client_id:

            return "已绑定"

        if (

            bound_conversation_id

            and item_conv

            and item_conv == bound_conversation_id

        ):

            return "已绑定"

        if bound_client_id and client_id == bound_client_id:

            return "已绑定"

        return "未绑定"



    def _tm_page_option_liveness_tag(self, page):
        if not isinstance(page, dict):
            return "离线"
        if hasattr(self, "_page_is_online_for_ui") and self._page_is_online_for_ui(page):
            return "在线"
        liveness = get_page_liveness(page)
        if liveness == "stale":
            return "过期"
        if liveness == "recently_seen":
            return "在线"
        return "离线"



    def _format_tm_page_option_label(

        self,

        page,

        bound_client_id="",

        current_client_id="",

        bound_page_instance_id="",

        bound_conversation_id="",

        resolved_bound_client_id="",

    ):

        if not isinstance(page, dict):

            return "无效页面"



        page_display_id = self._tm_page_display_id_text(page)

        url = self._tm_page_option_resolve_url(page) or "无URL"

        bind_tag = self._tm_page_option_bind_tag(

            page,

            bound_client_id=bound_client_id,

            current_client_id=current_client_id,

            bound_page_instance_id=bound_page_instance_id,

            bound_conversation_id=bound_conversation_id,

            resolved_bound_client_id=resolved_bound_client_id,

        )

        liveness_tag = self._tm_page_option_liveness_tag(page)

        return f"[{liveness_tag}][{bind_tag}] 页面ID:{page_display_id} | {url}"



    def _format_tm_page_option_tooltip(self, page):

        if not isinstance(page, dict):

            return "无效页面"

        page_display_id = self._tm_page_display_id_text(page)

        bind_text = self._tm_page_option_bind_tag(page)

        url = self._tm_page_option_resolve_url(page) or "-"

        liveness_tag = self._tm_page_option_liveness_tag(page)

        lines = [

            f"页面ID: {page_display_id}",

            f"状态: {liveness_tag}",

            f"绑定: {bind_text}",

            f"url: {url}",

        ]

        if self._is_ui_verbose_status_enabled() if hasattr(

            self, "_is_ui_verbose_status_enabled"

        ) else False:

            client_id = str(page.get("client_id") or "").strip() or "-"

            page_instance_id = str(page.get("page_instance_id") or "").strip() or "-"

            conversation_id = self._tm_page_option_resolve_conversation_id(page) or "-"

            lines.extend(

                [

                    f"client_id: {client_id}",

                    f"page_instance_id: {page_instance_id}",

                    f"conversation_id: {conversation_id}",

                ]

            )

        return "\n".join(lines)



    def _tm_page_combo_label(

        self,

        item,

        bound_client_id="",

        current_client_id="",

        bound_page_instance_id="",

        bound_conversation_id="",

        resolved_bound_client_id="",

    ):

        return self._format_tm_page_option_label(

            item,

            bound_client_id=bound_client_id,

            current_client_id=current_client_id,

            bound_page_instance_id=bound_page_instance_id,

            bound_conversation_id=bound_conversation_id,

            resolved_bound_client_id=resolved_bound_client_id,

        )



    def _tm_page_combo_client_id_from_data(self, data):

        if isinstance(data, dict):

            return str(data.get("client_id") or "").strip()

        return str(data or "").strip()



    def _tm_page_combo_page_from_index(self, index):

        if not hasattr(self, "tm_page_combo") or index < 0:

            return None

        combo = self.tm_page_combo

        for role in (Qt.UserRole, self.TM_PAGE_ITEM_DICT_ROLE):
            page = combo.itemData(index, role)
            if isinstance(page, dict):
                return page

        client_id = self._tm_page_combo_client_id_from_data(
            combo.itemData(index, Qt.UserRole)
        )

        if client_id:

            return self._find_tm_client_by_client_id(client_id)

        return None



    def _tm_page_combo_find_index_by_client_id(self, client_id):

        client_id = str(client_id or "").strip()

        if not client_id or not hasattr(self, "tm_page_combo"):

            return -1

        for idx in range(self.tm_page_combo.count()):

            if self._tm_page_combo_client_id_from_data(

                self.tm_page_combo.itemData(idx, Qt.UserRole)

            ) == client_id:

                return idx

        return -1



    def _tm_page_combo_find_index_by_normalized_url(self, normalized_url):

        normalized_url = (

            self._normalize_chatgpt_page_url(normalized_url)

            if hasattr(self, "_normalize_chatgpt_page_url")

            else str(normalized_url or "").strip()

        )

        if not normalized_url or not hasattr(self, "tm_page_combo"):

            return -1

        for idx in range(self.tm_page_combo.count()):

            page = self._tm_page_combo_page_from_index(idx)

            if not isinstance(page, dict):

                continue

            page_url = (

                self._normalize_chatgpt_page_url(

                    str(

                        page.get("url")

                        or page.get("href")

                        or ""

                    )

                )

                if hasattr(self, "_normalize_chatgpt_page_url")

                else str(

                    page.get("url")

                    or page.get("href")

                    or ""

                ).strip()

            )

            if page_url == normalized_url:

                return idx

        return -1



    def _tm_page_combo_find_index_for_page(self, page):

        if not isinstance(page, dict) or not hasattr(self, "tm_page_combo"):

            return -1

        target_instance = (page.get("page_instance_id") or "").strip()

        target_conv = (page.get("conversation_id") or "").strip()

        if not target_conv:

            target_conv = (

                self._client_conversation_id(page) if hasattr(self, "_client_conversation_id") else ""

            )

        target_client = (page.get("client_id") or "").strip()

        target_url = ""

        if hasattr(self, "_normalize_chatgpt_page_url"):

            target_url = self._normalize_chatgpt_page_url(

                str(

                    page.get("url")

                    or page.get("href")

                    or ""

                )

            )

        for idx in range(self.tm_page_combo.count()):

            item_page = self._tm_page_combo_page_from_index(idx)

            if not isinstance(item_page, dict):

                continue

            item_instance = (item_page.get("page_instance_id") or "").strip()

            item_conv = (item_page.get("conversation_id") or "").strip()

            if not item_conv and hasattr(self, "_client_conversation_id"):

                item_conv = self._client_conversation_id(item_page)

            item_client = (item_page.get("client_id") or "").strip()

            if target_instance and item_instance == target_instance:

                return idx

            if (

                target_conv

                and item_conv == target_conv

                and (not target_client or item_client == target_client)

            ):

                return idx

            if target_url and hasattr(self, "_normalize_chatgpt_page_url"):

                item_url = self._normalize_chatgpt_page_url(

                    str(

                        item_page.get("url")

                        or item_page.get("href")

                        or ""

                    )

                )

                if item_url == target_url:

                    return idx

        if target_client:

            return self._tm_page_combo_find_index_by_client_id(target_client)

        if target_url:

            return self._tm_page_combo_find_index_by_normalized_url(target_url)

        return -1



    def _pick_tm_page_selector_restore_index(self, pages, session=None):

        if not pages or not hasattr(self, "tm_page_combo"):

            return -1



        remote = normalize_remote_chatgpt(

            session.remote_chatgpt if session else None

        )

        bound_instance = (remote.get("page_instance_id") or "").strip()

        bound_conv = (

            self._remote_conversation_id(remote)

            if hasattr(self, "_remote_conversation_id")

            else (remote.get("conversation_id") or "").strip()

        )

        bound_client = (remote.get("client_id") or "").strip()

        manual_instance = (

            getattr(self, "_manual_current_tm_page_instance_id", "") or ""

        ).strip()

        manual_conv = (

            getattr(self, "_manual_current_tm_conversation_id", "") or ""

        ).strip()

        manual_client = (getattr(self, "_manual_current_tm_client_id", "") or "").strip()



        resolved_bound_client_id = ""

        if hasattr(self, "_resolve_bound_page_info"):

            bound_info, _bound_state, _bound_reason = self._resolve_bound_page_info()

            if isinstance(bound_info, dict):

                resolved_bound_client_id = (bound_info.get("client_id") or "").strip()



        def page_conv_id(page):

            if hasattr(self, "_client_conversation_id"):

                return self._client_conversation_id(page)

            return (page.get("conversation_id") or "").strip()



        def page_index_in_list(match_fn, *, online_only=False):

            for idx, item in enumerate(pages):

                if not isinstance(item, dict) or not match_fn(item):

                    continue

                if online_only and not self._tm_page_is_online_simple(item):

                    continue

                return idx

            return -1



        def combo_index_for_list_index(list_index):

            if list_index < 0:

                return -1

            target = pages[list_index]

            return self._tm_page_combo_find_index_for_page(target)



        def try_restore(list_index):

            return combo_index_for_list_index(list_index)



        bound_url = ""

        if session is not None:

            remote = normalize_remote_chatgpt(session.remote_chatgpt)

            bound_url = (

                self._normalize_chatgpt_page_url(

                    str(

                        remote.get("url")

                        or ""

                    )

                )

                if hasattr(self, "_normalize_chatgpt_page_url")

                else str(

                    remote.get("url")

                    or ""

                ).strip()

            )

        if not bound_url:

            bound_url = (

                self._normalize_chatgpt_page_url(

                    getattr(self, "bound_page_url", "")

                )

                if hasattr(self, "_normalize_chatgpt_page_url")

                else str(getattr(self, "bound_page_url", "") or "").strip()

            )

        if bound_url:

            combo_idx = self._tm_page_combo_find_index_by_normalized_url(bound_url)

            if combo_idx >= 0:

                return combo_idx



        if bound_conv:

            list_idx = page_index_in_list(

                lambda p: (

                    page_conv_id(p) == bound_conv

                    and (p.get("page_type") or "").strip() == "conversation"

                ),

                online_only=True,

            )

            combo_idx = try_restore(list_idx)

            if combo_idx >= 0:

                return combo_idx



        if bound_instance:

            list_idx = page_index_in_list(

                lambda p: (p.get("page_instance_id") or "").strip() == bound_instance,

                online_only=True,

            )

            combo_idx = try_restore(list_idx)

            if combo_idx >= 0:

                return combo_idx



        for candidate_client in (resolved_bound_client_id, bound_client):

            if not candidate_client:

                continue

            list_idx = page_index_in_list(

                lambda p, cid=candidate_client: (p.get("client_id") or "").strip() == cid,

                online_only=True,

            )

            combo_idx = try_restore(list_idx)

            if combo_idx >= 0:

                return combo_idx



        if manual_instance:

            list_idx = page_index_in_list(

                lambda p: (p.get("page_instance_id") or "").strip() == manual_instance,

                online_only=True,

            )

            combo_idx = try_restore(list_idx)

            if combo_idx >= 0:

                return combo_idx



        if manual_conv:

            list_idx = page_index_in_list(

                lambda p: page_conv_id(p) == manual_conv,

                online_only=True,

            )

            combo_idx = try_restore(list_idx)

            if combo_idx >= 0:

                return combo_idx



        for candidate_client in (manual_client,):

            if not candidate_client:

                continue

            combo_idx = self._tm_page_combo_find_index_by_client_id(candidate_client)

            if combo_idx >= 0:

                page = self._tm_page_combo_page_from_index(combo_idx)

                if isinstance(page, dict) and self._tm_page_is_online_simple(page):

                    return combo_idx



        if bound_instance:

            list_idx = page_index_in_list(

                lambda p: (p.get("page_instance_id") or "").strip() == bound_instance,

            )

            combo_idx = try_restore(list_idx)

            if combo_idx >= 0:

                return combo_idx



        if bound_conv:

            list_idx = page_index_in_list(

                lambda p: page_conv_id(p) == bound_conv,

            )

            combo_idx = try_restore(list_idx)

            if combo_idx >= 0:

                return combo_idx



        for candidate_client in (manual_client, bound_client):

            if not candidate_client:

                continue

            combo_idx = self._tm_page_combo_find_index_by_client_id(candidate_client)

            if combo_idx >= 0:

                return combo_idx



        return -1



    def _page_is_online(self, item):

        """UI 展示用在线判断（含 recently_seen）；绑定/发送仍用 _tm_page_is_online_simple。"""

        if hasattr(self, "_page_is_online_for_ui"):

            return self._page_is_online_for_ui(item)

        if hasattr(self, "_tm_page_is_online_simple"):

            return self._tm_page_is_online_simple(item)

        if not isinstance(item, dict):

            return False

        client_id = str(item.get("client_id") or "").strip()

        if not client_id:

            return False

        return not self._page_is_stale(item)



    def _tm_page_selector_signature(self, pages):

        now = time.time()

        signature_items = []

        for page in pages:

            if not isinstance(page, dict):

                continue

            last_seen = float(page.get("last_seen") or 0)

            last_seen_bucket = int(last_seen // 2) if last_seen > 0 else 0

            liveness = get_page_liveness(page, now=now)

            page_url = (

                page.get("_normalized_url")

                or (

                    self._normalize_chatgpt_page_url(

                        page.get("url")

                        or page.get("normalized_url")

                        or ""

                    )

                    if hasattr(self, "_normalize_chatgpt_page_url")

                    else (

                        page.get("url")

                        or page.get("normalized_url")

                        or ""

                    )

                )

            )

            bind_tag = self._tm_page_option_bind_tag(page)

            signature_items.append(

                (

                    page.get("client_id") or "",

                    page.get("page_instance_id") or "",

                    page.get("conversation_id") or "",

                    page_url,

                    bind_tag,

                    is_page_online(page, now=now),

                    liveness,

                    last_seen_bucket,

                )

            )

        return tuple(signature_items)

