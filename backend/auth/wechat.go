package auth

import (
	"encoding/json"
	"fmt"
	"net/http"
	"time"
)

// WechatAuthProvider 微信小程序鉴权（生产环境）
type WechatAuthProvider struct {
	AppID     string
	AppSecret string
	Client    *http.Client
}

// wechatAPIResponse 微信 jscode2session API 响应
type wechatAPIResponse struct {
	OpenID     string `json:"openid"`
	SessionKey string `json:"session_key"`
	UnionID    string `json:"unionid"`
	ErrCode    int    `json:"errcode"`
	ErrMsg     string `json:"errmsg"`
}

// WechatAuthError 微信鉴权错误
type WechatAuthError struct {
	ErrCode    int
	ErrMsg     string
	HTTPStatus int // 映射后的 HTTP 状态码
}

func (e *WechatAuthError) Error() string {
	return fmt.Sprintf("微信鉴权失败: errcode=%d, errmsg=%s", e.ErrCode, e.ErrMsg)
}

// NewWechatAuthProvider 创建微信鉴权提供者
func NewWechatAuthProvider(appID, appSecret string) *WechatAuthProvider {
	return &WechatAuthProvider{
		AppID:     appID,
		AppSecret: appSecret,
		Client: &http.Client{
			Timeout: 8 * time.Second, // 3s 连接 + 5s 读取
		},
	}
}

// Authenticate 调用微信 jscode2session API 鉴权
func (p *WechatAuthProvider) Authenticate(code string) (*AuthResult, error) {
	// 校验必填配置
	if p.AppID == "" || p.AppSecret == "" {
		return nil, &WechatAuthError{
			ErrCode:    -1,
			ErrMsg:     "微信小程序 AppID 或 AppSecret 未配置",
			HTTPStatus: http.StatusServiceUnavailable,
		}
	}

	if code == "" {
		return nil, &WechatAuthError{
			ErrCode:    -1,
			ErrMsg:     "登录 code 不能为空",
			HTTPStatus: http.StatusBadRequest,
		}
	}

	url := fmt.Sprintf(
		"https://api.weixin.qq.com/sns/jscode2session?appid=%s&secret=%s&js_code=%s&grant_type=authorization_code",
		p.AppID, p.AppSecret, code,
	)

	resp, err := p.Client.Get(url)
	if err != nil {
		return nil, &WechatAuthError{
			ErrCode:    -1,
			ErrMsg:     fmt.Sprintf("请求微信 API 失败: %v", err),
			HTTPStatus: http.StatusBadGateway,
		}
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, &WechatAuthError{
			ErrCode:    -1,
			ErrMsg:     fmt.Sprintf("微信 API 返回非 200 状态码: %d", resp.StatusCode),
			HTTPStatus: http.StatusBadGateway,
		}
	}

	var wxResp wechatAPIResponse
	if err := json.NewDecoder(resp.Body).Decode(&wxResp); err != nil {
		return nil, &WechatAuthError{
			ErrCode:    -1,
			ErrMsg:     fmt.Sprintf("解析微信响应失败: %v", err),
			HTTPStatus: http.StatusBadGateway,
		}
	}

	// 微信 API 错误码映射
	if wxResp.ErrCode != 0 {
		httpStatus := http.StatusBadGateway // 默认 502
		switch wxResp.ErrCode {
		case 40029: // invalid code
			httpStatus = http.StatusUnauthorized
		case 45011: // rate limit
			httpStatus = http.StatusTooManyRequests
		}
		return nil, &WechatAuthError{
			ErrCode:    wxResp.ErrCode,
			ErrMsg:     wxResp.ErrMsg,
			HTTPStatus: httpStatus,
		}
	}

	if wxResp.OpenID == "" {
		return nil, &WechatAuthError{
			ErrCode:    -1,
			ErrMsg:     "微信返回空 openid",
			HTTPStatus: http.StatusBadGateway,
		}
	}

	return &AuthResult{
		OpenID:     wxResp.OpenID,
		SessionKey: wxResp.SessionKey,
	}, nil
}
