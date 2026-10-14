import { Building2, Cloud, KeyRound, Laptop, Server, ShieldCheck, ShieldX, SquareTerminal } from '../../frontend/UICommon.js';
import { DiagramInteractive } from '../diagram-interactive/DiagramInteractive.jsx';
import './ProxyConnectionDiagram.css';

function ProxyConnectionDiagram({ onEvent }) {
  return (
    <DiagramInteractive
      ariaLabel="pac がローカルプロキシを経由して認証付き上流プロキシと Power Platform に接続する経路"
      className="proxy-connection-diagram"
      contentSize={{ width: 960, height: 570 }}
      displayMode="fit"
      onEvent={onEvent}
      renderMode="layout"
      title="認証付きプロキシ環境の接続経路"
    >
      <div className="proxy-connection-canvas">
        <div className="proxy-connection-note is-success">
          <ShieldCheck aria-hidden="true" size={22} />
          <span>認証情報を追加して、リクエストを上流プロキシへ転送</span>
        </div>

        <div className="proxy-connection-node is-pac">
          <SquareTerminal aria-hidden="true" size={28} />
          <strong>pac</strong>
        </div>
        <div className="proxy-connection-node is-local-proxy">
          <KeyRound aria-hidden="true" size={25} />
          <strong>ローカル<br />プロキシ</strong>
          <small>127.0.0.1:8888</small>
        </div>
        <div className="proxy-connection-node is-upstream-proxy">
          <Server aria-hidden="true" size={26} />
          <strong>認証付き<br />上流プロキシ</strong>
        </div>
        <div className="proxy-connection-node is-platform">
          <Cloud aria-hidden="true" size={30} />
          <strong>Microsoft<br />サーバー</strong>
          <span>Power Platform<br />テスト環境</span>
        </div>

        <div aria-hidden="true" className="proxy-connection-arrow is-pac-local" />
        <div aria-hidden="true" className="proxy-connection-arrow is-local-upstream" />
        <div aria-hidden="true" className="proxy-connection-arrow is-upstream-platform" />

        <div aria-hidden="true" className="proxy-connection-direct-route" />
        <div aria-hidden="true" className="proxy-connection-blocked-mark" />
        <div className="proxy-connection-note is-failure">
          <ShieldX aria-hidden="true" size={22} />
          <span>認証情報がないため、上流プロキシへ直接接続できない</span>
        </div>

        <div className="proxy-connection-route-label is-authenticated">認証情報を付与</div>
        <div className="proxy-connection-route-label is-direct">直接接続</div>

        <div className="proxy-connection-segments">
          <div className="proxy-connection-segment is-local">
            <span><Laptop aria-hidden="true" size={17} />ローカル PC</span>
          </div>
          <div className="proxy-connection-segment is-company">
            <span><Building2 aria-hidden="true" size={17} />会社ファイアウォール</span>
          </div>
          <div className="proxy-connection-segment is-cloud">
            <span><Cloud aria-hidden="true" size={17} />Microsoft Cloud</span>
          </div>
        </div>
      </div>
    </DiagramInteractive>
  );
}

export { ProxyConnectionDiagram };